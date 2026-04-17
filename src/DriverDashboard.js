import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { useParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import './DriverDashboard.css';

const BACKEND_URL = 'http://localhost:5000';
const WAREHOUSE_COORDS = [13.0827, 80.2707];
const socket = io(BACKEND_URL, { transports: ['websocket'] });

// ── Fuel consumption rates ──────────────────────────────────────────────────────
const PETROL_L_PER_100KM = 8.5;   // Realistic Chennai traffic: 8.5 L / 100 km
const EV_KWH_PER_100KM = 18;     // Realistic EV: 18 kWh / 100 km

// ── ORS backend proxy call ──────────────────────────────────────────────────────
// Calls POST /api/routes/directions — returns real road polyline from ORS
const fetchOrsRoute = async (waypoints) => {
  if (!waypoints || waypoints.length < 2) return null;
  try {
    const res = await axios.post(`${BACKEND_URL}/api/routes/directions`, { waypoints }, { timeout: 12000 });
    if (res.data && res.data.polyline && res.data.polyline.length > 1) {
      const durationMin = parseFloat(res.data.totalDuration) || 0;
      const distKm = parseFloat(res.data.totalDistance) || 0;
      return { polyline: res.data.polyline, distKm, durationMin };
    }
  } catch (e) {
    console.warn('[ORS fetch]', e.message);
  }
  // Straight-line fallback
  let distKm = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    distKm += haversine(waypoints[i][0], waypoints[i][1], waypoints[i + 1][0], waypoints[i + 1][1]);
  }
  return { polyline: waypoints, distKm, durationMin: distKm / 0.4 };
};

// ── Haversine ──────────────────────────────────────────────────────────────────
const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ── Icons ──────────────────────────────────────────────────────────────────────
const truckIcon = new L.Icon({
  iconUrl: 'https://img.icons8.com/plasticine/100/000000/truck.png',
  iconSize: [50, 50], iconAnchor: [25, 50], popupAnchor: [0, -50]
});

const warehouseIcon = L.divIcon({
  html: `<div class="dd-icon dd-warehouse">W</div>`,
  className: '', iconSize: [32, 32], iconAnchor: [16, 32]
});

const createStopIcon = (num, status) => {
  const cls = status === 'delivered' ? 'dd-icon-delivered'
    : status === 'in_transit' ? 'dd-icon-transit'
    : status === 'failed' ? 'dd-icon-failed'
    : 'dd-icon-pending';
  return L.divIcon({
    html: `<div class="dd-icon ${cls}">${status === 'delivered' ? '✓' : status === 'failed' ? '✗' : num}</div>`,
    className: '', iconSize: [32, 32], iconAnchor: [16, 32]
  });
};

const createStationIcon = (type) => L.divIcon({
  html: `<div class="dd-station-icon ${type === 'fuel' ? 'fuel' : 'ev'}">${type === 'fuel' ? '⛽' : '⚡'}</div>`,
  className: '', iconSize: [34, 34], iconAnchor: [17, 34]
});

// ── Map fly-to controller ──────────────────────────────────────────────────────
function MapFly({ center, zoom }) {
  const map = useMap();
  useEffect(() => { if (center) map.flyTo(center, zoom, { duration: 1.2 }); }, [center, zoom, map]);
  return null;
}

// ── Fuel bar component ─────────────────────────────────────────────────────────
function FuelBar({ level, maxRange, remaining, vehicleType }) {
  const pct = Math.max(0, Math.min(100, (remaining / maxRange) * 100));
  const color = pct < 20 ? '#e74c3c' : pct < 40 ? '#f39c12' : '#2ecc71';
  const icon = vehicleType === 'EV' ? '⚡' : '⛽';
  return (
    <div className="fuel-bar-wrapper">
      <span className="fuel-icon">{icon}</span>
      <div className="fuel-bar-track">
        <div
          className="fuel-bar-fill"
          style={{ width: `${pct}%`, background: color, transition: 'width 0.8s ease, background 0.5s' }}
        />
      </div>
      <span className="fuel-label" style={{ color }}>
        {remaining.toFixed(0)} / {maxRange} km
        {pct < 20 && <span className="fuel-warning"> ⚠</span>}
      </span>
    </div>
  );
}

// ── Mobile detection hook ─────────────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(() => window.innerWidth <= 768);
  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function DriverDashboard() {
  const { driverId } = useParams();
  const isMobile = useIsMobile();

  // ── state ─────────────────────────────────────────────
  const [route, setRoute] = useState(null);
  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);

  const [currentLocation, setCurrentLocation] = useState(null);
  const [mapCenter, setMapCenter] = useState(WAREHOUSE_COORDS);
  const [mapZoom, setMapZoom] = useState(12);

  // Per-leg routing
  const [legs, setLegs] = useState([]);            // array of { from, to, polyline, distKm, durationMin }
  const [currentLegIdx, setCurrentLegIdx] = useState(0);
  const [nextStopETA, setNextStopETA] = useState(null); // minutes to next stop

  // Fuel
  const [remainingRange, setRemainingRange] = useState(400);
  const [maxRange, setMaxRange] = useState(400);
  const [fuelPct, setFuelPct] = useState(100);

  // Fuel/charging stations across Chennai
  const [fuelStations, setFuelStations] = useState([]);
  const [chargingStations, setChargingStations] = useState([]);
  const [showStations, setShowStations] = useState(false);

  // Rerouting via fuel station
  const [rerouteStation, setRerouteStation] = useState(null);  // { name, lat, lng }
  const [rerouteETA, setRerouteETA] = useState(null);  // extra minutes
  const [reroutePolyline, setReroutePolyline] = useState(null);

  // Focus mode
  const [focusedStop, setFocusedStop] = useState(null);
  const [viewMode, setViewMode] = useState('full');

  // Completion
  const [isRouteComplete, setIsRouteComplete] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [returnPolyline, setReturnPolyline] = useState(null);

  // Alerts
  const [alert, setAlert] = useState(null);
  const [routeUpdated, setRouteUpdated] = useState(false);

  // Critical fuel alert
  const [criticalFuel, setCriticalFuel] = useState(null); // { stationName, detourPolyline }

  // Failed delivery
  const [failedDeliveryStop, setFailedDeliveryStop] = useState(null);
  const [failureReason, setFailureReason] = useState('absent');

  // Route totals
  const [routeTotals, setRouteTotals] = useState({ count: 0, remaining: 0, timeMins: 0, fuelConsumed: '0.0', fuelUnit: 'L' });

  // ── Mobile UX state ──────────────────────────────────────────────────────────
  const [mobileTab, setMobileTab] = useState('map'); // 'map' | 'stops' | 'fuel'

  // ── OTP delivery state ────────────────────────────────────────────────────────
  const [showOtpDialog, setShowOtpDialog] = useState(false);
  const [otpInput, setOtpInput]         = useState('');
  const [otpDeliveryId, setOtpDeliveryId] = useState(null);
  const [otpCustomerName, setOtpCustomerName] = useState(''); // shown in dialog header

  // ── Traffic delta state (Phase 2) ─────────────────────────────────────────────
  const [trafficExtraMin, setTrafficExtraMin] = useState(null); // +X min from last block
  const prevTimeMinsForTrafficRef = useRef(null); // capture pre-update total for delta calc
  const pendingTrafficDeltaRef    = useRef(false); // gate: only compute delta after block event

  // Sim-move for demo (when real GPS not available)
  const simRef = useRef(null);
  const simIdxRef = useRef(0);

  // Distance counter for fuel deduction
  const lastLocRef = useRef(null);
  const distTraveledRef = useRef(0);

  // ── helpers ───────────────────────────────────────────
  const showAlert = useCallback((type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 14000);
  }, []);

  const isEVDriver = (d) => (d || driver)?.vehicleType === 'EV';

  const kmToFuel = useCallback((km, driverData) => {
    const isEV = isEVDriver(driverData);
    const rate = isEV ? EV_KWH_PER_100KM : PETROL_L_PER_100KM;
    const val = (km * rate) / 100;
    return { val: val.toFixed(1), unit: isEV ? 'kWh' : 'L' };
  }, [driver]);

  const calcTotals = useCallback((r, driverData, legData) => {
    if (!r?.stops?.length) {
      setRouteTotals({ count: 0, remaining: 0, timeMins: 0, fuelConsumed: '0.0', fuelUnit: 'L' });
      return;
    }
    const count = r.stops.length;
    const remaining = r.stops.filter(s => s.status !== 'delivered').length;

    let totalDistKm = 0, totalDurMin = 0;
    if (legData && legData.length > 0) {
      legData.forEach(leg => {
        totalDistKm += leg.distKm || 0;
        totalDurMin += leg.durationMin || 0;
      });
    } else if (r.totalDistance) {
      const m = r.totalDistance.toString().match(/[\d.]+/);
      if (m) totalDistKm = parseFloat(m[0]);
    }
    if (totalDurMin === 0) totalDurMin = totalDistKm * 3 + count * 5;

    const { val: fuelConsumed, unit: fuelUnit } = kmToFuel(totalDistKm, driverData);
    setRouteTotals({ count, remaining, timeMins: Math.ceil(totalDurMin), fuelConsumed, fuelUnit });
  }, [driver, kmToFuel]);

  // ── fetch all fuel/charging stations once ─────────────
  const fetchAllStations = useCallback(async () => {
    try {
      const [fuelRes, evRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/fuel/stations`),
        axios.get(`${BACKEND_URL}/api/fuel/charging-stations`)
      ]);
      setFuelStations(fuelRes.data.stations || []);
      setChargingStations(evRes.data.stations || []);
    } catch (e) {
      console.warn('Could not load stations:', e.message);
    }
  }, []);

  // ── Build per-leg ORS routes ────────────────────────
  // Returns: [{ from, to, polyline, distKm, durationMin }]
  const buildLegs = useCallback(async (r, fromCoord) => {
    if (!r?.stops?.length) return [];
    const pendingStops = r.stops
      .filter(s => s.status !== 'delivered' && s.status !== 'failed' && s.pickupLocation?.coordinates)
      .map(s => ({
        id: s._id,
        lat: s.pickupLocation.coordinates[1],
        lng: s.pickupLocation.coordinates[0],
      }));

    if (pendingStops.length === 0) return [];

    const waypoints = [fromCoord || WAREHOUSE_COORDS, ...pendingStops.map(s => [s.lat, s.lng])];
    const builtLegs = [];

    for (let i = 0; i < waypoints.length - 1; i++) {
      const from = waypoints[i];
      const to = waypoints[i + 1];
      try {
        // Use ORS backend proxy for real road routing
        const result = await fetchOrsRoute([from, to]);
        if (result) {
          builtLegs.push({ from, to, polyline: result.polyline, distKm: result.distKm, durationMin: result.durationMin });
        }
      } catch (e) {
        console.error(`[Leg ${i}] Exception:`, e.message);
        // Fallback straight line
        const distKm = haversine(from[0], from[1], to[0], to[1]);
        builtLegs.push({ from, to, polyline: [from, to], distKm, durationMin: distKm / 0.4 });
      }
    }
    return builtLegs;
  }, []);

  // ── load driver route ──────────────────────────────────
  const fetchDriverData = useCallback(async (fromCoord) => {
    try {
      const res = await axios.get(`${BACKEND_URL}/api/routes/${driverId}`);
      const r = res.data;
      setRoute(r);
      setDriver(r.driver);

      const isEV = r.driver?.vehicleType === 'EV';
      const mRange = isEV ? 300 : 400;
      setMaxRange(mRange);
      const fuel = r.driver?.fuelLevel ?? 100;
      setFuelPct(fuel);
      setRemainingRange((fuel / 100) * mRange);

      // Build per-leg routes (start from warehouse unless fromCoord given)
      const start = fromCoord || WAREHOUSE_COORDS;
      if (!lastLocRef.current) {
        lastLocRef.current = { lat: start[0], lng: start[1] };
        setCurrentLocation({ lat: start[0], lng: start[1] });
      }

      const legData = await buildLegs(r, start);
      setLegs(legData);
      setCurrentLegIdx(0);
      if (legData.length > 0) {
        setNextStopETA(Math.ceil(legData[0].durationMin));
      }

      calcTotals(r, r.driver, legData);
      fetchAllStations();
    } catch (e) {
      console.error('[DriverDashboard] load error:', e);
    } finally {
      setLoading(false);
    }
  }, [driverId, calcTotals, buildLegs, fetchAllStations]);

  // ── initial load + socket ──────────────────────────────
  useEffect(() => {
    if (driverId) fetchDriverData();

    const onScheduleUpdate = (data) => {
      fetchDriverData(lastLocRef.current ? [lastLocRef.current.lat, lastLocRef.current.lng] : null);
      if (data?.message?.includes('block') || data?.message?.includes('traffic')) {
        showAlert('traffic', '🚧 Route updated due to traffic! New optimized path assigned.');
        setRouteUpdated(true);
        setTimeout(() => setRouteUpdated(false), 30000);
      }
    };

    const onRouteAssigned = (data) => {
      if (data && String(data.driverId) === String(driverId)) {
        fetchDriverData(lastLocRef.current ? [lastLocRef.current.lat, lastLocRef.current.lng] : null);
        showAlert('delivery', `📦 New delivery added to your route! ${data.message || ''}`);
      }
    };

    const onBreakdownReceived = (data) => {
      if (data && String(data.assignedDriver) === String(driverId)) {
        fetchDriverData(lastLocRef.current ? [lastLocRef.current.lat, lastLocRef.current.lng] : null);
        showAlert('delivery', `🚨 Breakdown help: ${data.reassignedDeliveries} extra deliveries added to your route!`);
      }
    };

    const onFuelAlert = (data) => {
      if (!data || String(data.driverId) !== String(driverId)) return;
      const newPct = data.fuelLevel ?? 0;
      setFuelPct(newPct);
      setRemainingRange(prev => (newPct / 100) * maxRange);
      if (newPct <= 20) {
        showAlert('fuel', `⛽ Low fuel (${newPct}%) — nearest stations highlighted on map.`);
        setShowStations(true);
      }
    };

    // ── CRITICAL FUEL ALERT from server (0% fuel, ORS detour ready) ───────────
    const onCriticalFuelAlert = (data) => {
      if (!data || String(data.driverId) !== String(driverId)) return;
      setFuelPct(0);
      setCriticalFuel({
        stationName: data.nearestStation?.name || 'Nearest Fuel Station',
        detourPolyline: data.detourPolyline || null,
        distKm: data.nearestStation?.distance_km || '?'
      });
      showAlert('critical', `🚨 CRITICAL: 0% fuel! Detour to ${data.nearestStation?.name || 'fuel station'} shown on map.`);
      setShowStations(true);
    };

    socket.on('scheduleUpdated', onScheduleUpdate);
    socket.on('routeAssigned', onRouteAssigned);
    socket.on('vehicleBreakdown', onBreakdownReceived);
    socket.on('fuelAlert', onFuelAlert);
    socket.on('criticalFuelAlert', onCriticalFuelAlert);

    const onTrafficBlockAlert = (data) => {
      // Capture current total time BEFORE the route gets re-fetched
      prevTimeMinsForTrafficRef.current = routeTotals.timeMins || 0;
      pendingTrafficDeltaRef.current    = true;
      const blockCount = data.blockCount || '';
      showAlert('traffic', data.message || `🚧 Road blocked! Route re-optimized around ${blockCount} traffic block(s). Recalculating…`);
      setRouteUpdated(true);
      // Delay slightly to let the banner render before heavy ORS re-fetch
      setTimeout(() => fetchDriverData(lastLocRef.current ? [lastLocRef.current.lat, lastLocRef.current.lng] : null), 2000);
      // Auto-clear route-updated badge after 30 s
      setTimeout(() => { setRouteUpdated(false); setTrafficExtraMin(null); }, 30000);
    };
    socket.on('trafficBlockAlert', onTrafficBlockAlert);

    return () => {
      socket.off('scheduleUpdated', onScheduleUpdate);
      socket.off('routeAssigned', onRouteAssigned);
      socket.off('vehicleBreakdown', onBreakdownReceived);
      socket.off('fuelAlert', onFuelAlert);
      socket.off('criticalFuelAlert', onCriticalFuelAlert);
      socket.off('trafficBlockAlert', onTrafficBlockAlert);
    };
  }, [driverId, fetchDriverData, showAlert]);

  // ── Route completeness ─────────────────────────────────
  useEffect(() => {
    if (route?.stops?.length) {
      const done = route.stops.every(s => s.status === 'delivered' || s.status === 'failed');
      setIsRouteComplete(done);
      calcTotals(route, driver, legs);
    }
  }, [route]);

  // ── Traffic delta: compute +X min after routeTotals updates post-block ────────
  useEffect(() => {
    if (pendingTrafficDeltaRef.current && routeTotals.timeMins > 0 && prevTimeMinsForTrafficRef.current !== null) {
      const delta = Math.ceil(routeTotals.timeMins - prevTimeMinsForTrafficRef.current);
      setTrafficExtraMin(delta > 1 ? delta : null); // only show meaningful deltas
      prevTimeMinsForTrafficRef.current = null;
      pendingTrafficDeltaRef.current    = false;
    }
  }, [routeTotals.timeMins]);

  // ── GPS watch + fuel consumption ───────────────────────
  useEffect(() => {
    if (!driverId) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCurrentLocation(newLoc);

        if (lastLocRef.current) {
          const dist = haversine(lastLocRef.current.lat, lastLocRef.current.lng, newLoc.lat, newLoc.lng);
          distTraveledRef.current += dist;
          setRemainingRange(prev => {
            const next = Math.max(0, prev - dist);
            setFuelPct(Math.round((next / maxRange) * 100));
            return next;
          });
        }
        lastLocRef.current = newLoc;

        socket.emit('updateDriverLocation', {
          driverId,
          location: { type: 'Point', coordinates: [newLoc.lng, newLoc.lat] }
        });
      },
      (err) => console.warn('GPS:', err.message),
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [driverId, maxRange]);

  // ── 30-second REST location heartbeat (independent of GPS watch) ────────────
  useEffect(() => {
    if (!driverId) return;
    const heartbeat = setInterval(() => {
      const loc = lastLocRef.current;
      if (!loc) return;
      axios.post(`${BACKEND_URL}/api/drivers/${driverId}/location`, { lat: loc.lat, lng: loc.lng })
        .catch(e => console.warn('[Heartbeat]', e.message));
    }, 30000);
    return () => clearInterval(heartbeat);
  }, [driverId]);

  // ── Simulate movement along CURRENT LEG polyline (demo) ─
  useEffect(() => {
    if (!legs.length || currentLocation || !driver) return;
    const currentLeg = legs[currentLegIdx];
    if (!currentLeg) return;

    if (simRef.current) clearInterval(simRef.current);
    simIdxRef.current = 0;

    simRef.current = setInterval(() => {
      if (simIdxRef.current >= currentLeg.polyline.length) {
        clearInterval(simRef.current);
        return;
      }
      const [lat, lng] = currentLeg.polyline[simIdxRef.current];
      const newLoc = { lat, lng };

      if (lastLocRef.current) {
        const dist = haversine(lastLocRef.current.lat, lastLocRef.current.lng, lat, lng);
        distTraveledRef.current += dist;
        setRemainingRange(prev => {
          const next = Math.max(0, prev - dist);
          setFuelPct(Math.round((next / maxRange) * 100));
          return next;
        });
      }
      lastLocRef.current = newLoc;
      setCurrentLocation(newLoc);

      socket.emit('updateDriverLocation', {
        driverId,
        location: { type: 'Point', coordinates: [lng, lat] }
      });

      simIdxRef.current += 3;
    }, 2000);

    return () => clearInterval(simRef.current);
  }, [legs, currentLegIdx, driver, maxRange, driverId, currentLocation]);

  // ── OTP handler ───────────────────────────────────────────────────────────
  // Opens OTP dialog instead of directly marking delivered
  const handleDeliverWithOtp = (deliveryId) => {
    setOtpDeliveryId(deliveryId);
    setOtpInput('');
    // Find customer name for contextual dialog header
    const stop = route?.stops?.find(s => s._id === deliveryId);
    setOtpCustomerName(stop?.customerName || stop?.customer?.name || '');
    setShowOtpDialog(true);
  };

  const handleOtpConfirm = async () => {
    // Accept if OTP is 4 digits OR empty (customer absent/OTP not required)
    if (otpInput.length !== 4 && otpInput.length !== 0) {
      showAlert('error', 'Please enter the 4-digit OTP from the customer.');
      return;
    }
    setShowOtpDialog(false);
    await handleStatusUpdate(otpDeliveryId, 'delivered', otpInput);
    setOtpInput('');
    setOtpDeliveryId(null);
  };

  const handleOtpSkip = async () => {
    setShowOtpDialog(false);
    await handleStatusUpdate(otpDeliveryId, 'delivered', null);
    setOtpInput('');
    setOtpDeliveryId(null);
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleStatusUpdate = async (deliveryId, newStatus, otp = null) => {
    try {
      await axios.put(`${BACKEND_URL}/api/deliveries/${deliveryId}/status`, { status: newStatus, otp });
      const updatedRoute = {
        ...route,
        stops: route.stops.map(s => s._id === deliveryId ? { ...s, status: newStatus } : s)
      };
      setRoute(updatedRoute);

      if (newStatus === 'delivered') {
        const deliveredStop = route.stops.find(s => s._id === deliveryId);
        if (deliveredStop?.pickupLocation?.coordinates) {
          const fromCoord = [
            deliveredStop.pickupLocation.coordinates[1],
            deliveredStop.pickupLocation.coordinates[0]
          ];
          lastLocRef.current = { lat: fromCoord[0], lng: fromCoord[1] };
          setCurrentLocation({ lat: fromCoord[0], lng: fromCoord[1] });

          const newLegData = await buildLegs(updatedRoute, fromCoord);
          setLegs(newLegData);
          setCurrentLegIdx(0);
          simIdxRef.current = 0;
          if (newLegData.length > 0) {
            setNextStopETA(Math.ceil(newLegData[0].durationMin));
          }
          calcTotals(updatedRoute, driver, newLegData);
        }
        if (focusedStop?._id === deliveryId) clearFocus();
      }
    } catch (_) { showAlert('error', 'Status update failed. Try again.'); }
  };

  const handleFocusStop = async (stop) => {
    if (viewMode === 'focus' && focusedStop?._id === stop._id) { clearFocus(); return; }
    setFocusedStop(stop);
    setViewMode('focus');
    const [lat, lng] = [stop.pickupLocation.coordinates[1], stop.pickupLocation.coordinates[0]];
    setMapCenter([lat, lng]);
    setMapZoom(15);
  };

  const clearFocus = () => {
    setFocusedStop(null);
    setViewMode('full');
    setMapZoom(12);
  };

  const handleReturnToWarehouse = async () => {
    if (!lastLocRef.current) { showAlert('error', 'Waiting for location...'); return; }
    try {
      const from = lastLocRef.current;
      const result = await fetchOrsRoute([[from.lat, from.lng], WAREHOUSE_COORDS]);
      if (result) {
        setReturnPolyline(result.polyline);
        setIsReturning(true);
        setNextStopETA(Math.ceil(result.durationMin));
      }
    } catch (_) { showAlert('error', 'Could not calculate return route.'); }
  };

  const handleCompleteShift = async () => {
    try {
      await axios.post(`${BACKEND_URL}/api/drivers/${driverId}/return-to-warehouse`);
      showAlert('delivery', '✅ Shift completed!');
      setTimeout(() => window.location.reload(), 2000);
    } catch (_) { showAlert('error', 'Error completing shift.'); }
  };

  const handleBreakdown = async () => {
    const loc = lastLocRef.current;
    if (!loc) { showAlert('error', 'Location unavailable.'); return; }
    if (!window.confirm('🚨 Report breakdown? Nearby driver will be assigned your deliveries.')) return;
    try {
      await axios.post(`${BACKEND_URL}/api/schedule/vehicle-breakdown`, {
        driverId, breakdownLocation: [loc.lat, loc.lng]
      });
      showAlert('delivery', '🚨 Breakdown reported. Help is on the way!');
    } catch (_) { showAlert('error', 'Failed to report breakdown.'); }
  };

  // ── Failed delivery logging ─────────────────────────────────────────────
  const handleFailedDelivery = async (stopId, reason) => {
    try {
      await axios.put(`${BACKEND_URL}/api/deliveries/${stopId}/status`, {
        status: 'failed',
        failureReason: reason
      });
      const updatedRoute = {
        ...route,
        stops: route.stops.map(s => s._id === stopId ? { ...s, status: 'failed' } : s)
      };
      setRoute(updatedRoute);
      setFailedDeliveryStop(null);
      setFailureReason('absent');
      showAlert('delivery', `❌ Delivery marked as failed (${reason}). Moving to next stop.`);
      if (lastLocRef.current) {
        const from = [lastLocRef.current.lat, lastLocRef.current.lng];
        const newLegs = await buildLegs(updatedRoute, from);
        setLegs(newLegs);
        setCurrentLegIdx(0);
        calcTotals(updatedRoute, driver, newLegs);
      }
    } catch (_) { showAlert('error', 'Failed to update delivery status.'); }
  };

  // ── Fuel station reroute ──────────────────────────────
  const handleRerouteViaStation = async (station) => {
    const loc = lastLocRef.current;
    if (!loc) { showAlert('error', 'Location unavailable for rerouting.'); return; }

    const nextStop = route?.stops?.find(s => s.status !== 'delivered' && s.status !== 'failed' && s.pickupLocation?.coordinates);
    if (!nextStop) { showAlert('error', 'No pending stops to reroute to.'); return; }

    const nextLat = nextStop.pickupLocation.coordinates[1];
    const nextLng = nextStop.pickupLocation.coordinates[0];

    try {
      showAlert('delivery', `⛽ Calculating route via ${station.name}...`);
      const [legToStation, legToNext] = await Promise.all([
        fetchOrsRoute([[loc.lat, loc.lng], [station.lat, station.lng]]),
        fetchOrsRoute([[station.lat, station.lng], [nextLat, nextLng]])
      ]);

      if (legToStation && legToNext) {
        const combinedPolyline = [...legToStation.polyline, ...legToNext.polyline];
        const totalMin = Math.ceil(legToStation.durationMin + legToNext.durationMin);
        const totalKm = legToStation.distKm + legToNext.distKm;
        const directMin = legs[currentLegIdx]?.durationMin || 0;
        const extraMin = Math.ceil(totalMin - directMin);

        setRerouteStation(station);
        setReroutePolyline(combinedPolyline);
        setRerouteETA(extraMin);
        setNextStopETA(totalMin);

        const { val: extraFuel, unit: fuelUnit } = kmToFuel(totalKm, driver);
        showAlert('fuel', `⛽ Rerouting via ${station.name} | Total: ${totalMin} min (+${extraMin > 0 ? extraMin : 0} min) | Est. fuel: ${extraFuel} ${fuelUnit}`);
      }
    } catch (e) {
      showAlert('error', 'Reroute calculation failed.');
    }
  };

  const clearReroute = () => {
    setRerouteStation(null);
    setReroutePolyline(null);
    setRerouteETA(null);
  };

  // ── derived values ─────────────────────────────────────────────────────────
  // Shift progress percentage
  const shiftPct = routeTotals.count > 0
    ? Math.round(((routeTotals.count - routeTotals.remaining) / routeTotals.count) * 100)
    : 0;

  if (loading) return (
    <div className="dd-loading">
      <div className="dd-spinner" />
      <p>Loading your route...</p>
    </div>
  );

  const noRoute = !route || !route.stops?.length || route.status === 'inactive';
  const isEV = driver?.vehicleType === 'EV';

  const visibleStations = isEV ? chargingStations : fuelStations;

  // Which polyline to show for the current leg
  const currentLegPolyline = legs[currentLegIdx]?.polyline || null;

  // Next pending stop
  const nextPendingStop = route?.stops?.find(s => s.status !== 'delivered' && s.status !== 'failed');

  return (
    <div className="dd-root">

      {/* ── OTP DIALOG ── */}
      {showOtpDialog && (
        <div className="dd-otp-overlay" onClick={(e) => { if (e.target.classList.contains('dd-otp-overlay')) setShowOtpDialog(false); }}>
          <div className="dd-otp-dialog">
            <div className="dd-otp-icon">🔐</div>
            <div className="dd-otp-title">Confirm Delivery</div>
            {otpCustomerName ? (
              <div style={{ margin: '0 0 8px', padding: '6px 14px', background: '#e8f5e9', borderRadius: 8, fontSize: '0.9rem', fontWeight: 700, color: '#27ae60', textAlign: 'center' }}>
                📦 Delivering to: {otpCustomerName}
              </div>
            ) : null}
            <div className="dd-otp-sub">
              Ask the customer for their <strong>4-digit OTP</strong> and enter it below to confirm delivery.
            </div>
            <input
              className="dd-otp-input"
              type="number"
              maxLength={4}
              placeholder="0000"
              value={otpInput}
              onChange={e => setOtpInput(e.target.value.slice(0, 4))}
              autoFocus
            />
            <div className="dd-otp-actions">
              <button
                className="dd-otp-confirm"
                onClick={handleOtpConfirm}
                disabled={otpInput.length !== 0 && otpInput.length !== 4}
                style={{ opacity: otpInput.length !== 0 && otpInput.length !== 4 ? 0.5 : 1 }}
              >
                ✅ Confirm Delivered
              </button>
              <button className="dd-otp-cancel" onClick={() => setShowOtpDialog(false)}>Cancel</button>
            </div>
            <button className="dd-otp-skip" onClick={handleOtpSkip}>Skip OTP (customer absent)</button>
          </div>
        </div>
      )}

      {/* ── CRITICAL FUEL BANNER ── */}
      {criticalFuel && (
        <div className="dd-critical-banner">
          <span className="dd-critical-icon">🚨</span>
          <div className="dd-critical-text">
            <strong>CRITICAL: 0% FUEL!</strong>
            <span>Detour route shown → {criticalFuel.stationName} ({criticalFuel.distKm} km)</span>
          </div>
          <button className="dd-critical-dismiss" onClick={() => setCriticalFuel(null)}>Dismiss</button>
        </div>
      )}

      {/* ── HEADER ── */}
      <header className="dd-header">
        <div className="dd-header-left">
          <div className="dd-avatar">{driver?.name?.charAt(0) || '?'}</div>
          <div>
            <h1 className="dd-driver-name">{driver?.name || 'Driver'}</h1>
            <p className="dd-subtitle">
              {isRouteComplete ? '✅ All Done — Return to Base'
                : viewMode === 'focus' ? '🧭 Navigation Mode'
                  : routeUpdated
                    ? (
                      <span>
                        🔄 Route Updated!
                        {trafficExtraMin && trafficExtraMin > 0
                          ? <span className="dd-traffic-delta"> +{trafficExtraMin} min</span>
                          : trafficExtraMin && trafficExtraMin < 0
                          ? <span className="dd-traffic-delta dd-traffic-delta--saved"> {trafficExtraMin} min saved</span>
                          : null
                        }
                      </span>
                    )
                    : fuelPct <= 0 ? '🚨 CRITICAL FUEL — Check Map!'
                      : fuelPct <= 20 ? `⚠️ Low Fuel — ${fuelPct}%`
                        : '🚚 Active Delivery Route'}
            </p>
          </div>
        </div>

        <div className="dd-header-right">
          <FuelBar level={fuelPct} maxRange={maxRange} remaining={remainingRange} vehicleType={driver?.vehicleType} />

          <button
            className={`dd-toggle-stations ${showStations ? 'active' : ''}`}
            onClick={() => setShowStations(s => !s)}
            title="Toggle fuel stations on map"
          >
            {isEV ? '⚡' : '⛽'} Stations
          </button>

          {route && !isRouteComplete && (
            <button className="dd-breakdown-btn" onClick={handleBreakdown}>🚨 SOS</button>
          )}
        </div>
      </header>

      {/* ── ALERT BANNER ── */}
      {alert && (
        <div className={`dd-alert dd-alert-${alert.type === 'critical' ? 'traffic' : alert.type}`}>
          <span className="dd-alert-icon">
            {alert.type === 'fuel' ? '⛽' : alert.type === 'traffic' || alert.type === 'critical' ? '🚧' : alert.type === 'error' ? '❌' : '📦'}
          </span>
          <span className="dd-alert-msg">{alert.msg}</span>
          <button className="dd-alert-close" onClick={() => setAlert(null)}>×</button>
        </div>
      )}

      {/* ── REROUTE BANNER ── */}
      {rerouteStation && (
        <div className="dd-alert dd-alert-fuel" style={{ background: '#fff3cd', borderColor: '#f0a500' }}>
          <span className="dd-alert-icon">⛽</span>
          <span className="dd-alert-msg">
            Rerouting via <strong>{rerouteStation.name}</strong>
            {rerouteETA !== null && rerouteETA > 0 && ` (+${rerouteETA} min)`}
            {' — '}<strong>{nextStopETA} min</strong> total to next stop
          </span>
          <button className="dd-alert-close" onClick={clearReroute}>✖ Cancel</button>
        </div>
      )}

      {/* ── SHIFT PROGRESS BAR ── */}
      {!noRoute && !isRouteComplete && routeTotals.count > 0 && (
        <div className="dd-shift-progress">
          <div className="dd-shift-track">
            <div className="dd-shift-fill" style={{ width: `${shiftPct}%` }} />
          </div>
          <span className="dd-shift-label">
            {routeTotals.count - routeTotals.remaining}/{routeTotals.count} delivered · {shiftPct}%
          </span>
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <div className="dd-body">

        {/* MAP */}
        <div className={`dd-map-wrap${isMobile && mobileTab !== 'map' ? ' dd-mobile-hidden' : ''}`}>
          <MapContainer center={WAREHOUSE_COORDS} zoom={12} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <MapFly center={mapCenter} zoom={mapZoom} />

            {/* Warehouse */}
            <Marker position={WAREHOUSE_COORDS} icon={warehouseIcon}>
              <Popup><strong>📦 Central Warehouse</strong><br />Starting point</Popup>
            </Marker>

            {/* Driver current position */}
            {currentLocation && (
              <Marker position={[currentLocation.lat, currentLocation.lng]} icon={truckIcon}>
                <Popup>
                  📍 Your Location<br />
                  {distTraveledRef.current.toFixed(1)} km traveled<br />
                  {nextStopETA !== null && <span>~{nextStopETA} min to next stop</span>}
                </Popup>
              </Marker>
            )}

            {/* Delivery stops */}
            {viewMode === 'full' && !noRoute && route.stops.map((stop, i) => {
              if (!stop.pickupLocation?.coordinates || stop.pickupLocation.coordinates.length < 2) return null;
              const [slat, slng] = [stop.pickupLocation.coordinates[1], stop.pickupLocation.coordinates[0]];
              if (isNaN(slat) || isNaN(slng)) return null;
              return (
                <Marker key={stop._id} position={[slat, slng]} icon={createStopIcon(i + 1, stop.status)}>
                  <Popup>
                    <strong>#{i + 1} {stop.customerName}</strong><br />
                    Status: <b>{stop.status}</b><br />
                    {stop.fullAddress && <span>{stop.fullAddress}</span>}
                  </Popup>
                </Marker>
              );
            })}

            {/* Focused single stop */}
            {viewMode === 'focus' && focusedStop && (
              <Marker
                position={[focusedStop.pickupLocation.coordinates[1], focusedStop.pickupLocation.coordinates[0]]}
                icon={L.divIcon({ html: '<div class="dd-icon dd-icon-target">🎯</div>', className: '', iconSize: [38, 38], iconAnchor: [19, 38] })}
              >
                <Popup>TARGET: {focusedStop.customerName}</Popup>
              </Marker>
            )}

            {/* Current leg road polyline — ORS real roads */}
            {viewMode === 'full' && !isReturning && !reroutePolyline && !criticalFuel?.detourPolyline && currentLegPolyline && (
              <Polyline positions={currentLegPolyline} pathOptions={{ color: routeUpdated ? '#2ecc71' : '#3b82f6', weight: 5, opacity: 0.9 }} />
            )}

            {/* Upcoming legs — real road routes */}
            {viewMode === 'full' && !isReturning && !reroutePolyline && legs.slice(currentLegIdx + 1).map((leg, i) => (
              <Polyline
                key={`future-leg-${i}`}
                positions={leg.polyline}
                pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.40, dashArray: '8,6' }}
              />
            ))}

            {/* Reroute polyline via station */}
            {reroutePolyline && (
              <Polyline positions={reroutePolyline} pathOptions={{ color: '#f39c12', weight: 5, dashArray: '10,5', opacity: 0.9 }} />
            )}

            {/* Critical fuel detour route */}
            {criticalFuel?.detourPolyline && (
              <Polyline positions={criticalFuel.detourPolyline} pathOptions={{ color: '#e74c3c', weight: 5, dashArray: '8,4', opacity: 0.95 }} />
            )}

            {/* Return route */}
            {returnPolyline && (
              <Polyline positions={returnPolyline} pathOptions={{ color: '#27ae60', weight: 5, dashArray: '10,6' }} />
            )}

            {/* Fuel / Charging Stations */}
            {showStations && visibleStations.map((s, i) => (
              <Marker key={`station-${i}`} position={[s.lat, s.lng]} icon={createStationIcon(isEV ? 'ev' : 'fuel')}>
                <Popup>
                  <strong>{s.name}</strong><br />
                  {s.distance && <span>~{s.distance} km away<br /></span>}
                  {s.type && <span>Type: {s.type}<br /></span>}
                  {!isRouteComplete && nextPendingStop && (
                    <button
                      onClick={() => handleRerouteViaStation(s)}
                      style={{ marginTop: 6, padding: '4px 10px', background: isEV ? '#27ae60' : '#e67e22', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', width: '100%' }}
                    >
                      🔁 Reroute via here
                    </button>
                  )}
                </Popup>
              </Marker>
            ))}

            {/* Highlight nearest 3 stations when low fuel */}
            {fuelPct <= 20 && showStations && visibleStations.slice(0, 3).map((s, i) => (
              <Circle key={`hl-${i}`} center={[s.lat, s.lng]}
                pathOptions={{ color: isEV ? '#27ae60' : '#e67e22', fillOpacity: 0.15, weight: 2 }} radius={400} />
            ))}
          </MapContainer>

          {/* Recenter button */}
          <button className="dd-recenter" onClick={() => {
            const loc = lastLocRef.current;
            if (loc) { setMapCenter([loc.lat, loc.lng]); setMapZoom(15); }
          }}>📍</button>

          {viewMode === 'focus' && (
            <button className="dd-recenter" style={{ bottom: '80px', fontSize: '1rem', color: '#e74c3c' }} onClick={clearFocus}>✖ Exit</button>
          )}

          {/* ── FLOATING NEXT STOP CARD (mobile map view) ── */}
          {isMobile && mobileTab === 'map' && nextPendingStop && !isRouteComplete && (() => {
            const stopIdx = route.stops.findIndex(s => s._id === nextPendingStop._id);
            const leg = stopIdx >= 0 && stopIdx < legs.length ? legs[stopIdx] : null;
            return (
              <div className="dd-floating-next" onClick={() => setMobileTab('stops')}>
                <div className="dd-floating-next-icon">📦</div>
                <div className="dd-floating-next-info">
                  <div className="dd-floating-next-name">{nextPendingStop.customerName}</div>
                  <div className="dd-floating-next-meta">📍 {nextPendingStop.fullAddress || 'Tap to see stops'}</div>
                </div>
                {leg && (
                  <div className="dd-floating-next-eta">~{Math.ceil(leg.durationMin)} min</div>
                )}
              </div>
            );
          })()}
        </div>

        {/* SIDEBAR */}
        <aside className={`dd-sidebar${isMobile && (mobileTab === 'stops' || mobileTab === 'fuel') ? ' dd-mobile-active' : ''}`}>

          {isRouteComplete ? (
            <div className="dd-complete-panel">
              <div className="dd-complete-icon">🎉</div>
              <h2>All Deliveries Done!</h2>
              <p>Great work today, {driver?.name?.split(' ')[0]}!</p>
              {!isReturning ? (
                <button className="dd-btn dd-btn-primary" onClick={handleReturnToWarehouse}>
                  🏭 Navigate to Warehouse
                </button>
              ) : (
                <>
                  <p className="dd-return-ok">🟢 Return route on map! (~{nextStopETA} min)</p>
                  <button className="dd-btn dd-btn-success" onClick={handleCompleteShift}>
                    ✅ Complete Shift
                  </button>
                </>
              )}
            </div>

          ) : noRoute ? (
            <div className="dd-empty">
              <div className="dd-empty-icon">📭</div>
              <h3>No Active Route</h3>
              <p>Waiting for deliveries to be assigned...</p>
              <div className="dd-waiting-dot" />
            </div>

          ) : (
            <>
              {/* Route Summary */}
              <div className="dd-summary">
                <h3 className="dd-summary-title">📊 Route Summary</h3>
                <div className="dd-summary-grid">
                  <div className="dd-summary-card">
                    <span className="dd-scard-icon">📦</span>
                    <div>
                      <div className="dd-scard-val">{routeTotals.count}</div>
                      <div className="dd-scard-label">Total Stops</div>
                    </div>
                  </div>
                  <div className="dd-summary-card">
                    <span className="dd-scard-icon">✅</span>
                    <div>
                      <div className="dd-scard-val" style={{ color: '#2ecc71' }}>{routeTotals.count - routeTotals.remaining}</div>
                      <div className="dd-scard-label">Delivered</div>
                    </div>
                  </div>
                  <div className="dd-summary-card">
                    <span className="dd-scard-icon">⏳</span>
                    <div>
                      <div className="dd-scard-val" style={{ color: '#f39c12' }}>{routeTotals.remaining}</div>
                      <div className="dd-scard-label">Remaining</div>
                    </div>
                  </div>
                  <div className="dd-summary-card">
                    <span className="dd-scard-icon">⏱️</span>
                    <div>
                      <div className="dd-scard-val">{routeTotals.timeMins}</div>
                      <div className="dd-scard-label">Est. Mins</div>
                    </div>
                  </div>
                  <div className="dd-summary-card dd-summary-card-wide">
                    <span className="dd-scard-icon">{isEV ? '⚡' : '⛽'}</span>
                    <div>
                      <div className="dd-scard-val">{routeTotals.fuelConsumed} {routeTotals.fuelUnit}</div>
                      <div className="dd-scard-label">Est. {isEV ? 'Energy' : 'Fuel'} for full route</div>
                    </div>
                  </div>
                  <div className="dd-summary-card dd-summary-card-wide">
                    <span className="dd-scard-icon">🛣️</span>
                    <div>
                      <div className="dd-scard-val">{distTraveledRef.current.toFixed(1)} km</div>
                      <div className="dd-scard-label">Distance Traveled</div>
                    </div>
                  </div>
                </div>

                {/* Live fuel bar in sidebar */}
                <div className="dd-sidebar-fuel">
                  <span style={{ fontSize: '0.78rem', color: '#888', marginBottom: 4, display: 'block' }}>Current Fuel / Range</span>
                  <FuelBar level={fuelPct} maxRange={maxRange} remaining={remainingRange} vehicleType={driver?.vehicleType} />
                </div>

                {/* Next stop ETA */}
                {nextStopETA !== null && routeTotals.remaining > 0 && (
                  <div style={{
                    marginTop: 10, padding: '8px 12px',
                    background: rerouteStation ? 'rgba(243,156,18,0.15)' : 'rgba(59,130,246,0.15)',
                    borderRadius: 8, borderLeft: `3px solid ${rerouteStation ? '#f39c12' : '#3b82f6'}`,
                    fontSize: '0.87rem'
                  }}>
                    {rerouteStation ? (
                      <span>⛽ Via <strong>{rerouteStation.name}</strong> → Next stop: <strong>{nextStopETA} min</strong></span>
                    ) : (
                      <span>🚦 Next stop in approx. <strong>{nextStopETA} min</strong></span>
                    )}
                  </div>
                )}
              </div>

              {/* Stop Cards */}
              <div className="dd-stops">
                {route.stops.map((stop, idx) => {
                  const focused = focusedStop?._id === stop._id;
                  const statusLabel = stop.status === 'delivered' ? '✅ Delivered'
                    : stop.status === 'in_transit' ? '🚚 In Transit'
                      : stop.status === 'failed' ? '❌ Failed'
                        : '⏳ Pending';
                  const isNextStop = nextPendingStop?._id === stop._id;
                  const legForStop = idx < legs.length ? legs[idx] : null;
                  const legETA = legForStop ? Math.ceil(legForStop.durationMin) : null;
                  const legDist = legForStop ? legForStop.distKm.toFixed(1) : null;
                  return (
                    <div key={stop._id} className={`dd-stop-card ${stop.status} ${focused ? 'focused' : ''} ${isNextStop ? 'dd-next-stop' : ''}`}>
                      <div className="dd-stop-header">
                        <div className={`dd-stop-num ${stop.status}`}>#{idx + 1}</div>
                        <div className="dd-stop-meta">
                          <strong className="dd-stop-name">{stop.customerName}</strong>
                          <span className="dd-stop-status">{statusLabel}</span>
                          {isNextStop && stop.status !== 'delivered' && stop.status !== 'failed' && (
                            <span className="dd-next-badge">▶ NEXT</span>
                          )}
                        </div>
                        {stop.status !== 'delivered' && stop.status !== 'failed' && (
                          <button
                            className={`dd-nav-btn ${focused ? 'active' : ''}`}
                            onClick={() => handleFocusStop(stop)}
                          >
                            {focused ? '✖' : '🗺️'}
                          </button>
                        )}
                      </div>

                      {stop.fullAddress && (
                        <p className="dd-stop-address">📍 {stop.fullAddress}</p>
                      )}

                      {/* Per-leg ETA display */}
                      {legETA !== null && stop.status !== 'delivered' && stop.status !== 'failed' && (
                        <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '2px 0 4px', paddingLeft: 6 }}>
                          ⏱ ~{legETA} min &nbsp;·&nbsp; 🛣 {legDist} km
                        </p>
                      )}

                      <div className="dd-stop-actions">
                        {stop.status === 'assigned' && (
                          <button className="dd-btn dd-btn-start" onClick={() => handleStatusUpdate(stop._id, 'in_transit')}>
                            ▶ Start
                          </button>
                        )}
                        {stop.status === 'in_transit' && (
                          <>
                            <button className="dd-btn dd-btn-success" onClick={() => handleDeliverWithOtp(stop._id)}>
                              ✅ Delivered
                            </button>
                            {failedDeliveryStop === stop._id ? (
                              <div className="dd-fail-panel">
                                <select
                                  value={failureReason}
                                  onChange={e => setFailureReason(e.target.value)}
                                  className="dd-fail-select"
                                >
                                  <option value="absent">Customer Absent</option>
                                  <option value="refused">Delivery Refused</option>
                                  <option value="wrong_address">Wrong Address</option>
                                  <option value="damaged">Package Damaged</option>
                                  <option value="other">Other</option>
                                </select>
                                <div className="dd-fail-actions">
                                  <button
                                    className="dd-btn dd-btn-fail-confirm"
                                    onClick={() => handleFailedDelivery(stop._id, failureReason)}
                                  >
                                    Confirm Failed
                                  </button>
                                  <button
                                    className="dd-btn dd-btn-fail-cancel"
                                    onClick={() => setFailedDeliveryStop(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                className="dd-btn dd-btn-fail"
                                onClick={() => setFailedDeliveryStop(stop._id)}
                              >
                                ❌ Failed
                              </button>
                            )}
                          </>
                        )}
                        {stop.status === 'delivered' && (
                          <span className="dd-delivered-badge">Delivered ✓</span>
                        )}
                        {stop.status === 'failed' && (
                          <span className="dd-failed-badge">❌ Failed</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* ── MOBILE BOTTOM TAB BAR ── */}
      {isMobile && (
        <nav className="dd-mobile-tabs">
          <button
            className={`dd-mobile-tab${mobileTab === 'map' ? ' active' : ''}`}
            onClick={() => setMobileTab('map')}
          >
            <div className="dd-mobile-tab-wrap">
              <span className="dd-mobile-tab-icon">🗺️</span>
            </div>
            Map
          </button>

          <button
            className={`dd-mobile-tab${mobileTab === 'stops' ? ' active' : ''}`}
            onClick={() => setMobileTab('stops')}
          >
            <div className="dd-mobile-tab-wrap">
              <span className="dd-mobile-tab-icon">📦</span>
              {routeTotals.remaining > 0 && (
                <span className="dd-mobile-tab-badge">{routeTotals.remaining}</span>
              )}
            </div>
            Stops
          </button>

          <button
            className={`dd-mobile-tab${mobileTab === 'fuel' ? ' active' : ''}`}
            onClick={() => setMobileTab('fuel')}
          >
            <div className="dd-mobile-tab-wrap">
              <span className="dd-mobile-tab-icon">{isEV ? '⚡' : '⛽'}</span>
              {fuelPct <= 20 && (
                <span className="dd-mobile-tab-badge">!</span>
              )}
            </div>
            {isEV ? 'Charge' : 'Fuel'}
          </button>

          {route && !isRouteComplete && (
            <button
              className="dd-mobile-tab"
              style={{ color: '#ef4444' }}
              onClick={handleBreakdown}
            >
              <span className="dd-mobile-tab-icon">🚨</span>
              SOS
            </button>
          )}
        </nav>
      )}
    </div>
  );
}
