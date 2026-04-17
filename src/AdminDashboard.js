import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, useMap, Circle } from 'react-leaflet';
import L from 'leaflet';
import './App.css';

// --- Configuration ---
const BACKEND_URL = "http://localhost:5000";
const AI_SERVICE_URL = "http://localhost:5001";
const socket = io(BACKEND_URL, { transports: ['websocket'] });
const WAREHOUSE_COORDS = [13.0827, 80.2707];

// Utility function to safely parse polylines (handles both JSON strings and encoded strings)
const parsePolyline = (polylineData) => {
    if (!polylineData) return null;

    try {
        // First try to parse as JSON (coordinate arrays from AI service)
        const parsed = JSON.parse(polylineData);
        if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
        }
    } catch (e) {
        // If JSON parsing fails, try decoding Google/OSRM encoded polyline format.
        if (typeof polylineData === 'string') {
            try {
                let index = 0;
                let lat = 0;
                let lng = 0;
                const points = [];

                while (index < polylineData.length) {
                    let b;
                    let shift = 0;
                    let result = 0;

                    do {
                        b = polylineData.charCodeAt(index++) - 63;
                        result |= (b & 0x1f) << shift;
                        shift += 5;
                    } while (b >= 0x20);
                    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
                    lat += dlat;

                    shift = 0;
                    result = 0;
                    do {
                        b = polylineData.charCodeAt(index++) - 63;
                        result |= (b & 0x1f) << shift;
                        shift += 5;
                    } while (b >= 0x20);
                    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
                    lng += dlng;

                    points.push([lat / 1e5, lng / 1e5]);
                }

                if (points.length > 0) return points;
            } catch {
                return null;
            }
        }
        return null;
    }

    return null;
};

// Per-driver route colors
const DRIVER_ROUTE_COLORS = [
    '#3b82f6', '#e74c3c', '#22c55e', '#f59e0b', '#a855f7',
    '#06b6d4', '#e67e22', '#10b981', '#c0392b', '#2980b9'
];

// ORS directions proxy helper for admin
// Tries full route first, then falls back to leg-by-leg stitching
const fetchOrsAdminRoute = async (waypoints, avoidPoints = []) => {
    if (!waypoints || waypoints.length < 2) return null;

    // 1. Try full multi-stop route in one call
    try {
        const res = await axios.post(
            `${BACKEND_URL}/api/routes/directions`,
            { waypoints, avoidPoints },
            { timeout: 12000 }
        );
        if (res.data?.polyline?.length > 2 && res.data?.source !== 'straight-line') {
            return { polyline: res.data.polyline, source: res.data.source || 'ors' };
        }
    } catch (e) {
        console.warn('[Admin ORS] Full route failed, trying leg-by-leg:', e.message);
    }

    // 2. Fallback: build each leg individually and stitch
    if (waypoints.length > 2) {
        const stitched = [];
        let anyOrsSuccess = false;
        for (let i = 0; i < waypoints.length - 1; i++) {
            try {
                const res = await axios.post(`${BACKEND_URL}/api/routes/directions`, {
                    waypoints: [waypoints[i], waypoints[i + 1]],
                    avoidPoints
                }, { timeout: 10000 });
                if (res.data?.polyline?.length > 1 && res.data?.source !== 'straight-line') {
                    stitched.push(...res.data.polyline);
                    anyOrsSuccess = true;
                } else {
                    return null;
                }
            } catch {
                return null;
            }
        }
        if (anyOrsSuccess && stitched.length > 2) return { polyline: stitched, source: 'stitched' };
    }

    return null;
};

// --- Icons ---
const createDriverIcon = (driverName, vehicleType) => {
    const initial = driverName ? driverName.charAt(0).toUpperCase() : '?';
    return L.divIcon({
        html: `<div class="driver-icon-container">
                 <img src="https://img.icons8.com/plasticine/100/000000/truck.png" class="driver-truck-img"/>
                 <span class="driver-initial">${initial}</span>
               </div>`,
        className: 'driver-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 40],
        popupAnchor: [0, -40]
    });
};

const warehouseIcon = new L.Icon({
    iconUrl: 'https://img.icons8.com/officel/80/000000/warehouse.png',
    iconSize: [45, 45],
    iconAnchor: [22, 44],
    popupAnchor: [0, -45]
});

const createDeliveryIcon = (status) => {
    const color = {
        'pending': '#007bff',
        'assigned': '#007bff',
        'in_transit': '#ffc107',
        'delivered': '#28a745',
        'failed': '#dc3545'
    }[status] || '#007bff';
    return L.divIcon({ html: `<div class="delivery-marker" style="background-color: ${color};"></div>`, className: '', iconSize: [16, 16], iconAnchor: [8, 8] });
};

// --- Helper Components ---

// 1. Map Recenter Controller
const MapRecenter = ({ center, zoom, bounds }) => {
    const map = useMap();
    useEffect(() => {
        if (bounds && bounds.length > 0) {
            // Fit bounds to show all route points
            map.fitBounds(bounds, { padding: [20, 20] });
        } else if (center) {
            map.flyTo(center, zoom || 13, { duration: 1.5 });
        }
    }, [center, zoom, bounds, map]);
    return null;
};

// 2. UNIFIED MAP CLICK HANDLER (Handles Traffic Blocks & Delivery Drops & New Delivery)
function MapClickHandler({ isBlockMode, isAddingDelivery, isSettingNewDeliveryLocation, onBlockAdd, onDeliveryAdd, onNewDeliveryLocationSet }) {
    useMapEvents({
        click(e) {
            if (isBlockMode) {
                onBlockAdd(e.latlng);
            } else if (isAddingDelivery) {
                onDeliveryAdd(e.latlng);
            } else if (isSettingNewDeliveryLocation) {
                onNewDeliveryLocationSet(e.latlng);
            }
        }
    });
    return null;
}

// 3. Warehouse Modal
const WarehouseDetailModal = ({ isOpen, onClose, deliveries }) => {
    const [activeTab, setActiveTab] = useState('status');
    const [history, setHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    useEffect(() => {
        if (isOpen && activeTab === 'history') {
            setLoadingHistory(true);
            axios.get(`${BACKEND_URL}/api/deliveries/history`)
                .then(res => {
                    const sortedHistory = res.data.sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));
                    setHistory(sortedHistory);
                })
                .catch(err => console.error(err))
                .finally(() => setLoadingHistory(false));
        }
    }, [isOpen, activeTab]);

    if (!isOpen) return null;
    const pendingCount = deliveries.filter(d => d.status === 'pending').length;
    const activeCount = deliveries.filter(d => ['assigned', 'in_transit'].includes(d.status)).length;

    return (
        <div className="modal-overlay">
            <div className="modal-content wide">
                <button onClick={onClose} className="close-modal-btn">&times;</button>
                <h2>Warehouse Details</h2>
                <div className="modal-tabs">
                    <button onClick={() => setActiveTab('status')} className={activeTab === 'status' ? 'active' : ''}>Current Status</button>
                    <button onClick={() => setActiveTab('history')} className={activeTab === 'history' ? 'active' : ''}>Delivery History</button>
                </div>
                {activeTab === 'status' && (
                    <div className="warehouse-tab-content" style={{ padding: '20px' }}>
                        <div style={{ display: 'flex', gap: '20px' }}>
                            <div className="panel" style={{ flex: 1, textAlign: 'center' }}>
                                <h3>Pending Processing</h3>
                                <h1 style={{ color: '#f39c12' }}>{pendingCount}</h1>
                            </div>
                            <div className="panel" style={{ flex: 1, textAlign: 'center' }}>
                                <h3>Out for Delivery</h3>
                                <h1 style={{ color: '#3498db' }}>{activeCount}</h1>
                            </div>
                        </div>
                    </div>
                )}
                {activeTab === 'history' && (
                    <div className="history-modal-content warehouse-tab-content">
                        {loadingHistory ? <p>Loading...</p> : (
                            <table className="history-table">
                                <thead><tr><th>ID</th><th>Driver</th><th>Status</th><th>Time</th></tr></thead>
                                <tbody>
                                    {history.map(item => (
                                        <tr key={item._id}>
                                            <td>...{item._id.slice(-6)}</td>
                                            <td>{item.assignedDriver?.name || 'N/A'}</td>
                                            <td><span className={`badge ${item.status}`}>{item.status}</span></td>
                                            <td>{new Date(item.completedAt || item.updatedAt).toLocaleDateString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// 4. Add Delivery Modal
const AddDeliveryModal = ({ isOpen, onClose, onSave, mapLocation }) => {
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [fullAddress, setFullAddress] = useState('');
    const [area, setArea] = useState('urban');
    const [zone, setZone] = useState('Unzoned');
    const [weight, setWeight] = useState(5);
    const [size, setSize] = useState('medium'); // small, medium, large
    const [deadline, setDeadline] = useState(480);
    const [emergency, setEmergency] = useState(false);

    if (!isOpen) return null;

    const handleSave = () => {
        if (!customerName || !mapLocation) { alert('Name and Location required'); return; }
        onSave({ customerName, customerPhone, fullAddress, area, zone, weight, size, deadline, emergency });
        setCustomerName(''); setCustomerPhone(''); setFullAddress(''); setArea('urban'); setZone('Unzoned'); setWeight(5); setSize('medium'); setDeadline(480); setEmergency(false);
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <button onClick={onClose} className="close-modal-btn">&times;</button>
                <h2>Add New Delivery</h2>
                <p className="help-text">Location: {mapLocation ? `${mapLocation.lat.toFixed(4)}, ${mapLocation.lng.toFixed(4)}` : 'None'}</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Customer Name" required />
                    <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="Phone Number" />
                    <input value={fullAddress} onChange={e => setFullAddress(e.target.value)} placeholder="Full Address" />

                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Area Type</label>
                        <select value={area} onChange={e => setArea(e.target.value)} style={{ width: '100%', padding: '8px' }}>
                            <option value="urban">Urban</option>
                            <option value="suburban">Suburban</option>
                            <option value="rural">Rural</option>
                        </select>
                    </div>

                    <input value={zone} onChange={e => setZone(e.target.value)} placeholder="Zone (Optional)" />

                    <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Weight (kg)</label>
                            <input type="number" value={weight} onChange={e => setWeight(Number(e.target.value))} min="0.1" step="0.1" />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Package Size</label>
                            <select value={size} onChange={e => setSize(e.target.value)} style={{ width: '100%', padding: '8px' }}>
                                <option value="small">Small (Bike)</option>
                                <option value="medium">Medium (Truck)</option>
                                <option value="large">Large (Heavy Truck)</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Delivery Deadline (minutes)</label>
                        <input type="number" value={deadline} onChange={e => setDeadline(Number(e.target.value))} min="30" />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input type="checkbox" checked={emergency} onChange={e => setEmergency(e.target.checked)} id="emergency" />
                        <label htmlFor="emergency" style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Emergency Delivery (Medicine/Urgent)</label>
                    </div>
                </div>

                <div className="modal-actions">
                    <button onClick={handleSave} style={{ background: '#28a745' }}>Create Order</button>
                    <button onClick={onClose} className="cancel-btn" style={{ background: '#6c757d' }}>Cancel</button>
                </div>
            </div>
        </div>
    );
};

// 5. Notification Toast
const Notification = ({ message, onDismiss, isError }) => {
    useEffect(() => { if (message) { const t = setTimeout(onDismiss, 5000); return () => clearTimeout(t); } }, [message, onDismiss]);
    if (!message) return null;
    return <div className={`notification ${isError ? 'error' : ''}`}><p>{message}</p><button onClick={onDismiss} className="dismiss-btn">&times;</button></div>;
};

// --- MAIN ADMIN DASHBOARD ---
function AdminDashboard() {
    const [activeView, setActiveView] = useState('dashboard');
    const [drivers, setDrivers] = useState([]);
    const [deliveries, setDeliveries] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [selectedDriver, setSelectedDriver] = useState(null);
    const [routeFocusDriverId, setRouteFocusDriverId] = useState('');
    const effectiveRouteDriverId = selectedDriver || routeFocusDriverId;
    const [mapCenter, setMapCenter] = useState(WAREHOUSE_COORDS);

    // --- Comparison / Traffic States ---
    const [comparisonData, setComparisonData] = useState(null);
    const [comparisonView, setComparisonView] = useState('algo1'); // 'algo1' | 'algo2'
    const [isTrafficMode, setIsTrafficMode] = useState(false);
    const [blockages, setBlockages] = useState([]);
    const [showRouteComparison, setShowRouteComparison] = useState(false);
    // Auto-reoptimize when a traffic block is added
    const [autoReoptimize, setAutoReoptimize] = useState(true);
    // Track how many times routes were reoptimized today
    const [reoptimizeCount, setReoptimizeCount] = useState(0);
    // Per-driver comparison states (Phase 1)
    const [comparisonDriverId, setComparisonDriverId] = useState('');
    const [comparisonLoading, setComparisonLoading] = useState(false);

    // UI States
    const [isAddingDelivery, setIsAddingDelivery] = useState(false);
    const [newDeliveryLocation, setNewDeliveryLocation] = useState(null);
    const [isDeliveryModalOpen, setDeliveryModalOpen] = useState(false);

    // Automatic Allocation States
    const [showNewDeliverySidebar, setShowNewDeliverySidebar] = useState(false);
    const [newDeliveryData, setNewDeliveryData] = useState({
        customerName: '',
        customerPhone: '',
        fullAddress: '',
        area: 'urban',
        zone: 'Unzoned',
        weight: 5,
        size: 'medium',
        deadline: 480,
        emergency: false
    });
    const [isWarehouseModalOpen, setWarehouseModalOpen] = useState(false);
    const [algorithm, setAlgorithm] = useState('gmaps-tsp');
    const [notification, setNotification] = useState({ msg: '', isError: false });
    const [appStatus, setAppStatus] = useState('ready');
    const [fuelStations, setFuelStations] = useState([]);

    // ── Breakdown Notifications ──────────────────────────────────────────────────
    const [breakdownAlerts, setBreakdownAlerts] = useState([]);
    const [fuelAlerts, setFuelAlerts] = useState([]); // Low-fuel alerts for admin notification bell
    const [showNotifications, setShowNotifications] = useState(false);

    // ── New Delivery ORS Geocoding ────────────────────────────────────────────────
    const [geocodeStatus, setGeocodeStatus] = useState('');
    const [isGeocoding, setIsGeocoding] = useState(false);

    // ── SLA Breach Alerts ────────────────────────────────────────────────────────
    const [slaBreaches, setSlaBreaches] = useState([]);
    const [showSlaPanel, setShowSlaPanel] = useState(false);

    // ── Driver Performance Analytics ─────────────────────────────────────────────
    const [driverPerformance, setDriverPerformance] = useState([]);
    const [showPerformancePanel, setShowPerformancePanel] = useState(false);
    const [performanceLoading, setPerformanceLoading] = useState(false);



    // ── Admin OSRM road routes ───────────────────────────────────────────────────
    // Map of driverId → { color, polyline: [[lat,lng], ...] }
    const [adminRoutePolylines, setAdminRoutePolylines] = useState({});
    const [isRoutingAdmin, setIsRoutingAdmin] = useState(false);

    const mapControlLabelStyle = {
        color: '#1f2937',
        fontWeight: 700,
        fontSize: '0.83rem',
        marginBottom: '6px'
    };

    const mapControlSelectStyle = {
        width: '100%',
        padding: '8px 10px',
        border: '1px solid #cbd5e1',
        borderRadius: '6px',
        background: '#ffffff',
        color: '#111827',
        fontWeight: 600,
        outline: 'none'
    };

    const getVehicleIcon = (vehicleType = '') => {
        const v = String(vehicleType).toLowerCase();
        if (v.includes('bike')) return '🏍';
        if (v.includes('heavy')) return '🚛';
        if (v.includes('truck')) return '🚚';
        if (v.includes('van')) return '🚐';
        return '🚚';
    };

    // Fetch Data
    const fetchData = useCallback(async () => {
        try {
            const [dRes, delRes, rRes] = await Promise.all([
                axios.get(`${BACKEND_URL}/api/drivers`),
                axios.get(`${BACKEND_URL}/api/deliveries`),
                axios.get(`${BACKEND_URL}/api/routes`)
            ]);
            setDrivers(dRes.data || []);
            setDeliveries(delRes.data || []);
            setRoutes(rRes.data || []);
        } catch (err) {
            console.error(err);
        }
    }, []);

    // ── Build focused driver route for the Admin map via ORS/OSRM ─────────────────────────
    const buildAdminRoutes = useCallback(async (routeList, focusedDriverId) => {
        if (!routeList || routeList.length === 0 || !focusedDriverId) {
            setAdminRoutePolylines({});
            return;
        }

        const activeRoute = routeList.find(r => {
            const dId = r.driverId || r.driver?._id;
            return String(dId) === String(focusedDriverId);
        });

        if (!activeRoute) {
            setAdminRoutePolylines({});
            return;
        }

        setIsRoutingAdmin(true);
        const result = {};

        const driverId = activeRoute.driverId || activeRoute.driver?._id;
        const stops = (activeRoute.stops || []).filter(s => s.pickupLocation?.coordinates);

        if (driverId && stops.length > 0) {
            const color = DRIVER_ROUTE_COLORS[0];
            const waypoints = [
                WAREHOUSE_COORDS,
                ...stops.map(s => [s.pickupLocation.coordinates[1], s.pickupLocation.coordinates[0]])
            ];
            const avoidPoints = blockages.map(b => [b.lat, b.lng]);

            // 1. Prefer live directions route. This avoids stale/straight fallback polylines.
            const liveRoute = await fetchOrsAdminRoute(waypoints, avoidPoints);
            if (liveRoute?.polyline?.length > 2) {
                result[driverId] = {
                    color,
                    polyline: liveRoute.polyline,
                    driverName: activeRoute.driver?.name || 'Driver',
                    source: liveRoute.source || 'directions'
                };
            } else {
                // 2. Fall back to stored route only when it has detailed geometry.
                const storedPolyline = activeRoute.polyline ? parsePolyline(activeRoute.polyline) : null;
                if (storedPolyline && storedPolyline.length > waypoints.length + 2) {
                    result[driverId] = {
                        color,
                        polyline: storedPolyline,
                        driverName: activeRoute.driver?.name || 'Driver',
                        source: 'stored'
                    };
                }
            }
        }

        setAdminRoutePolylines(result);
        setIsRoutingAdmin(false);
    }, [blockages]);

    // Re-build only the focused driver route to avoid routing API rate limits.
    useEffect(() => {
        if (!effectiveRouteDriverId || routes.length === 0) {
            setAdminRoutePolylines({});
            return;
        }
        buildAdminRoutes(routes, effectiveRouteDriverId);
    }, [routes, effectiveRouteDriverId, blockages, buildAdminRoutes]);

    // Keep route focus aligned with explicit tracked driver, while preserving manual selection.
    useEffect(() => {
        if (selectedDriver) {
            setRouteFocusDriverId(selectedDriver);
            return;
        }

        const hasCurrentFocus = routeFocusDriverId && drivers.some(d => String(d._id) === String(routeFocusDriverId));
        if (hasCurrentFocus) return;

        const firstOnRouteDriver = drivers.find(d => !d.isAvailable);
        const fallbackDriver = firstOnRouteDriver || drivers[0];
        setRouteFocusDriverId(fallbackDriver?._id || '');
    }, [selectedDriver, drivers, routeFocusDriverId]);

    useEffect(() => {
        fetchData();
        socket.on('scheduleUpdated', (data) => {
            if (data?.message) setNotification({ msg: data.message, isError: false });
            fetchData();
        });
        socket.on('driverLocationUpdated', (dData) => {
            setDrivers(prev => prev.map(d => d._id === dData._id ? dData : d));
        });
        socket.on('fuelAlert', (data) => {
            if (data?.stations) {
                setFuelStations(data.stations.map(s => ({ ...s, driverId: data.driverId })));
                setNotification({ msg: `⛽ Low fuel alert: Driver at ${data.fuelLevel}%`, isError: true });
            }
            // ── Add to the notification bell so admin is informed ─────────────────
            if (data) {
                const driverName = drivers.find(d => String(d._id) === String(data.driverId))?.name || 'A driver';
                const fuelAlertEntry = {
                    id: Date.now(),
                    driverId: data.driverId,
                    driverName,
                    fuelLevel: data.fuelLevel ?? 0,
                    time: new Date().toLocaleTimeString(),
                    dismissed: false,
                };
                setFuelAlerts(prev => [fuelAlertEntry, ...prev.slice(0, 19)]);
            }
        });
        socket.on('trafficBlockUpdate', (data) => {
            if (data?.message) setNotification({ msg: data.message, isError: false });
            if (data.blockages) {
                setBlockages(data.blockages.map(b => ({ lat: b[0], lng: b[1] })));
            }
            fetchData();
        });
        socket.on('vehicleBreakdown', (data) => {
            if (data?.message) setNotification({ msg: data.message, isError: true });
            if (data) {
                const alertEntry = {
                    id: Date.now(),
                    driverId: data.breakdownDriver,
                    driverName: data.breakdownDriverName || 'Unknown Driver',
                    assignedTo: data.assignedDriverName || 'Another Driver',
                    location: data.location,
                    reassignedCount: data.reassignedDeliveries || 0,
                    time: new Date().toLocaleTimeString(),
                    message: data.message || 'Vehicle Breakdown Reported',
                    dismissed: false,
                };
                setBreakdownAlerts(prev => [alertEntry, ...prev]);
            }
            fetchData();
        });

        // ── Route block alert (admin side confirmation) ───────────────────────
        socket.on('trafficBlockAlert', (data) => {
            setNotification({ msg: `🚧 Alert sent to all drivers: ${data.blockCount} road block(s) active.`, isError: false });
        });
        // ── Critical fuel alert (0% fuel — ORS detour triggered on driver side) ─
        socket.on('criticalFuelAlert', (alertData) => {
            setNotification({ msg: alertData.message, isError: true });
            const driverName = alertData.driverName || 'A driver';
            setFuelAlerts(prev => [{
                id: Date.now(),
                driverId: alertData.driverId,
                driverName,
                fuelLevel: 0,
                time: new Date().toLocaleTimeString(),
                dismissed: false,
                critical: true
            }, ...prev.slice(0, 19)]);
            if (alertData.nearestStation) {
                setFuelStations([{ ...alertData.nearestStation, driverId: alertData.driverId }]);
            }
        });
        return () => {
            socket.off('scheduleUpdated');
            socket.off('driverLocationUpdated');
            socket.off('trafficBlockUpdate');
            socket.off('vehicleBreakdown');
            socket.off('fuelAlert');
            socket.off('criticalFuelAlert');
            socket.off('trafficBlockAlert');
        };
    }, [fetchData]);

    // ── 30-second driver location polling (lightweight admin map update) ──────
    useEffect(() => {
        const pollLocations = async () => {
            try {
                const res = await axios.get(`${BACKEND_URL}/api/drivers/locations`);
                if (res.data && Array.isArray(res.data)) {
                    setDrivers(prev => prev.map(d => {
                        const loc = res.data.find(l => String(l._id) === String(d._id));
                        if (!loc) return d;
                        return {
                            ...d,
                            currentLocation: { type: 'Point', coordinates: [loc.lng, loc.lat] },
                            fuelLevel: loc.fuelLevel
                        };
                    }));
                }
            } catch (e) { /* silent — polling is best-effort */ }
        };
        const interval = setInterval(pollLocations, 30000);
        return () => clearInterval(interval);
    }, []);

    // --- Standard Handlers ---

    // MODIFIED: Accepts blockages
    const handleGenerateSchedule = async () => {
        setAppStatus('generating');
        setComparisonData(null);
        setNotification({ msg: "AI is optimizing routes...", isError: false });

        // Convert Leaflet LatLng objects to array for Python
        const blockageArray = blockages.map(b => [b.lat, b.lng]);

        try {
            await axios.post(`${BACKEND_URL}/api/schedule`, {
                algorithm,
                blockages: blockageArray // SEND TRAFFIC DATA TO BACKEND
            });
            setNotification({ msg: `Schedule Generated! (Avoided ${blockages.length} jams)`, isError: false });
            fetchData();
        } catch (err) { setNotification({ msg: "Optimization failed. Check Python Service.", isError: true }); }
        finally { setAppStatus('ready'); }
    };

    const handleSaveDelivery = async (details) => {
        try {
            await axios.post(`${BACKEND_URL}/api/deliveries`, {
                pickupLocation: { type: "Point", coordinates: [newDeliveryLocation.lng, newDeliveryLocation.lat] },
                ...details
            });
            setNotification({ msg: 'Delivery Created!', isError: false });
            fetchData();
        } catch (e) { setNotification({ msg: 'Creation Failed.', isError: true }); }
        setIsAddingDelivery(false); setNewDeliveryLocation(null); setDeliveryModalOpen(false);
    };

    // NEW: Automatic Allocation for New Deliveries
    const handleCreateAndAllocateDelivery = async () => {
        if (!newDeliveryData.customerName || !newDeliveryLocation) {
            setNotification({ msg: 'Customer name and location required!', isError: true });
            return;
        }

        try {
            // Single POST: backend auto-allocates to the nearest available driver
            const deliveryResponse = await axios.post(`${BACKEND_URL}/api/deliveries`, {
                pickupLocation: { type: "Point", coordinates: [newDeliveryLocation.lng, newDeliveryLocation.lat] },
                ...newDeliveryData
            });

            const { assignedDriverName } = deliveryResponse.data;
            const msg = assignedDriverName
                ? `📦 Delivery created & assigned to ${assignedDriverName}!`
                : `📦 Delivery created. No driver available — marked as pending.`;

            setNotification({ msg, isError: false });
            setShowNewDeliverySidebar(false);
            setNewDeliveryData({
                customerName: '',
                customerPhone: '',
                fullAddress: '',
                area: 'urban',
                zone: 'Unzoned',
                weight: 5,
                size: 'medium',
                deadline: 480,
                emergency: false
            });
            setNewDeliveryLocation(null);
            fetchData();
        } catch (e) {
            setNotification({ msg: 'Failed to create delivery. Check server.', isError: true });
        }
    };

    // ── ORS Geocoding for the + New Delivery sidebar ─────────────────────────
    const handleGeocodeNewDelivery = async () => {
        const addr = newDeliveryData.fullAddress;
        if (!addr || addr.trim().length < 3) { setGeocodeStatus('Enter a valid address first'); return; }
        setIsGeocoding(true);
        setGeocodeStatus('Searching...');
        try {
            const res = await axios.get(`${BACKEND_URL}/api/routes/geocode?text=${encodeURIComponent(addr)}`);
            setNewDeliveryLocation({ lat: res.data.lat, lng: res.data.lng });
            setGeocodeStatus(`✅ ${res.data.label || 'Location set!'}`);
        } catch (e) {
            setGeocodeStatus('❌ Geocoding failed. Try a different address or click the map.');
        } finally {
            setIsGeocoding(false);
        }
    };

    // NEW: Vehicle Breakdown Handler
    const handleVehicleBreakdown = async (driverId) => {
        const driver = drivers.find(d => d._id === driverId);
        if (!driver || !driver.currentLocation) {
            setNotification({ msg: 'Driver location not available!', isError: true });
            return;
        }

        try {
            await axios.post(`${BACKEND_URL}/api/schedule/vehicle-breakdown`, {
                driverId: driverId,
                breakdownLocation: [driver.currentLocation.coordinates[1], driver.currentLocation.coordinates[0]]
            });
            setNotification({ msg: 'Breakdown reported! Reassigning deliveries...', isError: true });
            fetchData();
        } catch (e) {
            setNotification({ msg: 'Failed to handle breakdown.', isError: true });
        }
    };

    // Simulate a small move for a driver and update fuel (calls backend)
    const simulateMove = async (driverId) => {
        try {
            const driver = drivers.find(d => d._id === driverId);
            if (!driver || !driver.currentLocation?.coordinates) { setNotification({ msg: 'Driver location missing', isError: true }); return; }
            const curLat = driver.currentLocation.coordinates[1];
            const curLng = driver.currentLocation.coordinates[0];
            // small offset move (~500m)
            const newLat = curLat + 0.005;
            const newLng = curLng + 0.005;

            const res = await axios.post(`${BACKEND_URL}/api/drivers/${driverId}/update-location`, { lat: newLat, lng: newLng });
            if (res.data && res.data.driver) {
                setDrivers(prev => prev.map(d => d._id === driverId ? res.data.driver : d));
                setFuelStations(res.data.stations || []);
                setNotification({ msg: `Driver moved. Fuel: ${res.data.driver.fuelLevel}%`, isError: res.data.driver.fuelLevel <= 20 });
            }
        } catch (err) {
            console.error(err);
            setNotification({ msg: 'Simulate move failed', isError: true });
        }
    };

    // ── (Warehouse Demo removed — use Quick Actions to generate schedule) ────
    // ─────────────────────────────────────────────────────


    // Auto-drain fuel for on-route drivers (1% every 45s = distance/time simulation)
    useEffect(() => {
        const interval = setInterval(async () => {
            const onRoute = drivers.filter(d => !d.isAvailable && typeof d.fuelLevel === 'number' && d.fuelLevel > 0);
            for (const d of onRoute) {
                try {
                    const res = await axios.post(`${BACKEND_URL}/api/drivers/${d._id}/drain-fuel`, { amount: 1 });
                    if (res.data?._id) {
                        setDrivers(prev => prev.map(dr => dr._id === d._id ? res.data : dr));
                    }
                } catch (e) { /* silent */ }
            }
        }, 45000);
        return () => clearInterval(interval);
    }, [drivers]);
    // ───────────────────────────────────────────────────────────────────

    const handleResetAll = async () => {
        if (window.confirm('⚠ Emergency Reset: This will clear all routes and return drivers to warehouse. Continue?')) {
            try {
                // Reset drivers
                await axios.post(`${BACKEND_URL}/api/drivers/reset-all`);
                // Also clear all non-completed routes from DB
                const routeData = await axios.get(`${BACKEND_URL}/api/routes`);
                await Promise.all(
                    (routeData.data || []).map(r =>
                        axios.delete(`${BACKEND_URL}/api/routes/${r._id}`).catch(() => {})
                    )
                );
            } catch (e) { /* ignore partial failures */ }
            setNotification({ msg: '✅ System Reset Complete — all routes cleared.', isError: false });
            setRoutes([]);
            setAdminRoutePolylines({});
            setComparisonData(null);
            setBlockages([]);
            fetchData();
        }
    };

    const handleDeleteDelivery = async (id) => {
        if (window.confirm("Delete this delivery?")) {
            await axios.delete(`${BACKEND_URL}/api/deliveries/${id}`);
            fetchData();
        }
    };

    const handleViewDriverOnMap = (driverId) => {
        setSelectedDriver(driverId);
        setActiveView('map');
        const driver = drivers.find(d => d._id === driverId);
        if (driver && driver.currentLocation?.coordinates) {
            setMapCenter([driver.currentLocation.coordinates[1], driver.currentLocation.coordinates[0]]);
        }
    };

    // --- NEW: Advanced Features Handlers ---

    // 1. Toggle Traffic Mode
    const toggleTrafficMode = () => {
        const entering = !isTrafficMode;
        setIsTrafficMode(entering);
        setIsAddingDelivery(false);
        setComparisonData(null);
        if (entering) {
            setNotification({ msg: "🚧 TRAFFIC MODE ACTIVE — Click any road on the map to add a block.", isError: false });
            // Change cursor to crosshair on the map
            document.querySelectorAll('.leaflet-container').forEach(el => el.style.cursor = 'crosshair');
        } else {
            setNotification({ msg: '✅ Traffic mode off.', isError: false });
            document.querySelectorAll('.leaflet-container').forEach(el => el.style.cursor = '');
        }
    };

    // 2. Handle Map Click for Blockage
    const handleBlockMapClick = async (latlng) => {
        const newBlockages = [...blockages, latlng];
        setBlockages(newBlockages);

        if (!autoReoptimize) {
            setNotification({ msg: `🛑 Block #${newBlockages.length} added. Click "Reoptimize Now" to apply.`, isError: false });
            return;
        }

        setNotification({ msg: `🛑 Block added — auto-reoptimizing routes around ${newBlockages.length} block(s)...`, isError: false });
        setAppStatus('generating');
        setComparisonData(null);

        try {
            await axios.post(`${BACKEND_URL}/api/schedule`, {
                algorithm,
                blockages: newBlockages.map(b => [b.lat, b.lng])
            });
            setReoptimizeCount(c => c + 1);
            setNotification({ msg: `✅ Routes reoptimized around ${newBlockages.length} block(s). Drivers notified.`, isError: false });
            fetchData();
        } catch (err) {
            setNotification({ msg: "Auto-optimization failed. Check AI service.", isError: true });
        } finally {
            setAppStatus('ready');
        }
    };

    // Manual reoptimize trigger (used when autoReoptimize is off)
    const handleManualReoptimize = async () => {
        if (blockages.length === 0) {
            setNotification({ msg: 'No active blocks to reoptimize around.', isError: true });
            return;
        }
        setAppStatus('generating');
        try {
            await axios.post(`${BACKEND_URL}/api/schedule`, {
                algorithm,
                blockages: blockages.map(b => [b.lat, b.lng])
            });
            setReoptimizeCount(c => c + 1);
            setNotification({ msg: `✅ Routes reoptimized. ${drivers.filter(d => !d.isAvailable).length} driver(s) notified.`, isError: false });
            fetchData();
        } catch (err) {
            setNotification({ msg: 'Reoptimization failed.', isError: true });
        } finally {
            setAppStatus('ready');
        }
    };

    // ── Haversine helper for AdminDashboard (used in comparison) ──────────────
    const haversineAdmin = (lat1, lng1, lat2, lng2) => {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // 3. Comparison Mode — per-driver, BOTH metrics normalised to ORS real roads
    const handleCompare = async (overrideDriverId) => {
        const activeDrivers = drivers.filter(d => !d.isAvailable);
        const resolvedId = overrideDriverId || comparisonDriverId || activeDrivers[0]?._id;

        if (!resolvedId) {
            setNotification({ msg: 'No active drivers on route. Generate a schedule first.', isError: true });
            return;
        }

        const driver = drivers.find(d => d._id === resolvedId);
        if (!driver) return;

        const driverDeliveries = deliveries.filter(d =>
            (String(d.assignedDriver) === String(resolvedId) ||
             String(d.assignedDriver?._id) === String(resolvedId)) &&
            ['assigned', 'in_transit'].includes(d.status)
        );

        if (driverDeliveries.length === 0) {
            setNotification({ msg: `No active deliveries for ${driver.name}.`, isError: true });
            return;
        }

        setComparisonLoading(true);
        setNotification({ msg: `🔍 Computing ORS routes for ${driver.name}...`, isError: false });

        try {
            // ── STEP 1: Previous route = current DB stop order via ORS (normalised metric) ──
            const prevWaypoints = [
                WAREHOUSE_COORDS,
                ...driverDeliveries.map(d => [
                    d.pickupLocation.coordinates[1],
                    d.pickupLocation.coordinates[0]
                ])
            ];
            const prevOrs = await fetchOrsAdminRoute(prevWaypoints);
            const prevPolyline = prevOrs?.polyline || null;

            // Compute previous ORS distance from detailed polyline
            let prevOrsKm = 0;
            if (prevPolyline && prevPolyline.length > 1) {
                for (let i = 0; i < prevPolyline.length - 1; i++) {
                    prevOrsKm += haversineAdmin(prevPolyline[i][0], prevPolyline[i][1], prevPolyline[i + 1][0], prevPolyline[i + 1][1]);
                }
            } else {
                // Fallback: sum straight-line legs if ORS failed
                for (let i = 0; i < prevWaypoints.length - 1; i++) {
                    prevOrsKm += haversineAdmin(prevWaypoints[i][0], prevWaypoints[i][1], prevWaypoints[i + 1][0], prevWaypoints[i + 1][1]);
                }
            }

            const prevDurMin = prevOrsKm > 0 ? (prevOrsKm / 30) * 60 : 0; // ~30 km/h city avg
            const isEV = driver.vehicleType === 'EV';
            const prevFuelVal = isEV ? (prevOrsKm * 18 / 100).toFixed(1) : (prevOrsKm * 8.5 / 100).toFixed(1);
            const fuelUnit = isEV ? 'kWh' : 'L';

            // ── STEP 2: Optimised route via AI service (uses ORS internally) ──
            const blockageArray = blockages.map(b => [b.lat, b.lng]);
            const aiRes = await axios.post(`${AI_SERVICE_URL}/compare`, {
                drivers: [driver],
                deliveries: driverDeliveries,
                blockages: blockageArray
            });

            // ── STEP 3: Merge — override algo_2 with our ORS-identical baseline ──
            const optDistKm = parseFloat((aiRes.data.algo_1?.distance || '0').replace(/[^\d.]/g, '')) || 0;
            const optDurMin = parseFloat((aiRes.data.algo_1?.duration || '0').replace(/[^\d.]/g, '')) || 0;
            const timeSavedMin = Math.max(0, prevDurMin - optDurMin);
            const fuelSavedVal = Math.abs(prevOrsKm - optDistKm) > 0
                ? isEV ? ((prevOrsKm - optDistKm) * 18 / 100).toFixed(1) : ((prevOrsKm - optDistKm) * 8.5 / 100).toFixed(1)
                : aiRes.data.algo_1?.ev_energy_saved || '0';

            const mergedData = {
                ...aiRes.data,
                driverName: driver.name,
                driverId: resolvedId,
                isEV,
                // Previous: replaced with ORS-computed metrics for fair comparison
                algo_2: {
                    ...aiRes.data.algo_2,
                    name: 'Original Stop Order (ORS)',
                    color: '#e74c3c',
                    distance: `${prevOrsKm.toFixed(2)} km`,
                    duration: `${Math.ceil(prevDurMin)} min`,
                    fuel: `${prevFuelVal} ${fuelUnit}`,
                    ev_energy: isEV ? `${prevFuelVal} kWh` : 'N/A',
                    ev_range_used: isEV ? `${(prevOrsKm / 300 * 100).toFixed(1)}%` : 'N/A',
                    polyline: prevPolyline ? JSON.stringify(prevPolyline) : aiRes.data.algo_2?.polyline,
                },
                // Optimised: keep AI result, but ALWAYS gate EV fields on isEV to
                // prevent the AI service's kWh values bleeding through for non-EV drivers
                algo_1: {
                    ...aiRes.data.algo_1,
                    name: 'AI Optimized (ORS)',
                    color: '#27ae60',
                    // Duration / distance from AI service (ORS-based internally)
                    // EV fields — forced to 'N/A' for non-EV, computed for EV
                    ev_energy:      isEV ? (aiRes.data.algo_1?.ev_energy      || `${(optDistKm * 18 / 100).toFixed(1)} kWh`)                          : 'N/A',
                    ev_range_used:  isEV ? (aiRes.data.algo_1?.ev_range_used  || `${(optDistKm / 300 * 100).toFixed(1)}%`)                             : 'N/A',
                    ev_energy_saved:isEV ? (aiRes.data.algo_1?.ev_energy_saved|| `${((prevOrsKm - optDistKm) * 18 / 100).toFixed(2)} kWh saved`)        : 'N/A',
                    ev_range_saved: isEV ? (aiRes.data.algo_1?.ev_range_saved || `${((prevOrsKm - optDistKm) / 300 * 100).toFixed(1)}%`)                 : 'N/A',
                    // Time saved — computed from ORS durations (authoritative), NOT from AI service baseline
                    saved: timeSavedMin > 0 ? `${Math.ceil(timeSavedMin)} min` : (aiRes.data.algo_1?.saved || '0 min'),
                },
            };

            setComparisonData(mergedData);
            if (!comparisonDriverId) setComparisonDriverId(resolvedId);
            setNotification({ msg: `✅ Per-driver comparison ready for ${driver.name}!`, isError: false });
        } catch (err) {
            console.error(err);
            setNotification({ msg: 'Comparison Failed. Ensure AI service is running.', isError: true });
        } finally {
            setComparisonLoading(false);
        }
    };

    // ── Helper: Get best map position for a driver ────────────────────────────
    // When on-route: show at first assigned delivery stop (not stuck at warehouse)
    // When available: show at warehouse
    const getDriverMapPosition = (driver) => {
        if (!driver.isAvailable) {
            // Find first assigned delivery for this driver
            const firstDel = deliveries.find(d =>
                (d.assignedDriver === driver._id || d.assignedDriver?._id === driver._id) &&
                ['assigned', 'in_transit'].includes(d.status) &&
                d.pickupLocation?.coordinates
            );
            if (firstDel) {
                return [
                    firstDel.pickupLocation.coordinates[1],
                    firstDel.pickupLocation.coordinates[0]
                ];
            }
        }
        // Fallback: use currentLocation or warehouse
        if (driver.currentLocation?.coordinates) {
            return [driver.currentLocation.coordinates[1], driver.currentLocation.coordinates[0]];
        }
        return WAREHOUSE_COORDS;
    };
    // ─────────────────────────────────────────────────────────────────────────

    // Filter Logic
    const filteredDrivers = selectedDriver ? drivers.filter(d => d._id === selectedDriver) : drivers;
    const filteredRoutes = selectedDriver ? routes.filter(r => r.driverId === selectedDriver || r.driver?._id === selectedDriver) : routes;
    const filteredDeliveries = selectedDriver
        ? deliveries.filter(d => d.assignedDriver === selectedDriver || d.assignedDriver?._id === selectedDriver)
        : deliveries;
    const focusedRoutePolyline = !comparisonData && !showRouteComparison && effectiveRouteDriverId
        ? adminRoutePolylines[effectiveRouteDriverId]?.polyline || null
        : null;

    // Metrics
    const totalRevenue = deliveries.reduce((acc, d) => acc + (d.cost || 50), 0);
    const completedCount = deliveries.filter(d => d.status === 'delivered').length;
    const activeTrucks = drivers.filter(d => !d.isAvailable && d.vehicleType === 'Truck').length;
    const activeBikes = drivers.filter(d => !d.isAvailable && d.vehicleType === 'Bike').length;

    // ── SLA Breach Detection ─────────────────────────────────────────────────
    // deadline = minutes from 8AM. Compute breach if current time > 8AM + deadline
    const slaBreachList = deliveries.filter(d => {
        if (d.status === 'delivered' || d.status === 'failed') return false;
        if (!d.deadline) return false;
        const startOfDay = new Date(); startOfDay.setHours(8, 0, 0, 0);
        const deadlineMs = startOfDay.getTime() + (d.deadline * 60 * 1000);
        return Date.now() > deadlineMs;
    });

    // ── Driver Performance (computed from deliveries) ────────────────────────
    const driverPerfMap = drivers.map(driver => {
        const driverDeliveries = deliveries.filter(d =>
            String(d.assignedDriver) === String(driver._id) ||
            String(d.assignedDriver?._id) === String(driver._id)
        );
        const dDelivered = driverDeliveries.filter(d => d.status === 'delivered').length;
        const dFailed = driverDeliveries.filter(d => d.status === 'failed').length;
        const dTotal = driverDeliveries.length;
        const successRate = dTotal > 0 ? Math.round((dDelivered / dTotal) * 100) : 0;
        return { driver, dDelivered, dFailed, dTotal, successRate };
    }).filter(p => p.dTotal > 0).sort((a, b) => b.successRate - a.successRate);

    return (
        <div className="dashboard" style={{ flexDirection: 'row' }}>
            {/* Sidebar Navigation */}
            <div style={{ width: '250px', background: '#2c3e50', color: 'white', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '20px', background: '#1a252f', textAlign: 'center' }}>
                    <h3 style={{ margin: 0 }}>Admin Panel</h3>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {[['dashboard', '🏠 Dashboard'], ['map', '🗺 Live Map'], ['drivers', '🚛 Drivers'], ['deliveries', '📦 Deliveries']].map(([view, label]) => (
                        <li key={view}
                            style={{ padding: '15px 20px', borderBottom: '1px solid #34495e', cursor: 'pointer', background: activeView === view ? '#3498db' : 'transparent', fontWeight: activeView === view ? 'bold' : 'normal' }}
                            onClick={() => { setActiveView(view); setSelectedDriver(null); }}>
                            {label}
                        </li>
                    ))}
                    <li style={{ padding: '15px 20px', borderBottom: '1px solid #34495e', cursor: 'pointer', background: activeView === 'traffic' ? '#e74c3c' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={() => setActiveView('traffic')}>
                        <span>🚧 Traffic Jams</span>
                        {blockages.length > 0 && <span style={{ background: '#c0392b', color: 'white', fontSize: '0.68rem', padding: '1px 7px', borderRadius: 20, fontWeight: 700 }}>{blockages.length}</span>}
                    </li>
                    <li style={{ padding: '15px 20px', borderBottom: '1px solid #34495e', cursor: 'pointer', background: activeView === 'comparison' ? '#9b59b6' : 'transparent' }} onClick={() => { setActiveView('comparison'); }}>
                        📊 Route Comparison
                    </li>

                    <li style={{ padding: '15px 20px', borderBottom: '1px solid #34495e', cursor: 'pointer' }} onClick={() => setWarehouseModalOpen(true)}>
                        📋 Warehouse Stats
                    </li>
                </ul>
                <div style={{ marginTop: 'auto', padding: '20px' }}>
                    <button onClick={handleResetAll} className="reset-button" style={{ background: '#e74c3c' }}>⚠ System Reset</button>
                    <button onClick={() => window.location.href = '/login'} style={{ marginTop: '10px', width: '100%', background: '#95a5a6', border: 'none', padding: '10px', color: 'white' }}>Logout</button>
                </div>
            </div>

            {/* Main Content */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
                <Notification message={notification.msg} isError={notification.isError} onDismiss={() => setNotification({ msg: '', isError: false })} />
                <AddDeliveryModal isOpen={isDeliveryModalOpen} onClose={() => setDeliveryModalOpen(false)} onSave={handleSaveDelivery} mapLocation={newDeliveryLocation} />
                <WarehouseDetailModal isOpen={isWarehouseModalOpen} onClose={() => setWarehouseModalOpen(false)} deliveries={deliveries} />

                <header style={{ padding: '1rem', background: 'white', borderBottom: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
                    <h2 style={{ margin: 0, color: '#2c3e50' }}>Parcel Distribution Control Center</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        {/* Breakdown Notification Bell */}
                        <div style={{ position: 'relative' }}>
                            {/* ── Notification Bell: Breakdowns + Low Fuel ──────── */}
                            {(() => {
                                const totalUnread = breakdownAlerts.filter(a => !a.dismissed).length + fuelAlerts.filter(a => !a.dismissed).length;
                                return (
                                    <>
                                        <button
                                            onClick={() => setShowNotifications(n => !n)}
                                            title="Alerts (Breakdowns & Low Fuel)"
                                            style={{
                                                position: 'relative',
                                                background: totalUnread > 0 ? 'linear-gradient(135deg, #e74c3c, #c0392b)' : '#ecf0f1',
                                                color: totalUnread > 0 ? 'white' : '#555',
                                                border: 'none', padding: '8px 14px', borderRadius: '50px',
                                                cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem',
                                                boxShadow: totalUnread > 0 ? '0 0 0 3px rgba(231,76,60,0.3)' : 'none',
                                                transition: 'all 0.3s',
                                            }}
                                        >
                                            🔔
                                            {totalUnread > 0 && (
                                                <span style={{
                                                    position: 'absolute', top: '-4px', right: '-4px',
                                                    background: '#f39c12', color: 'white', borderRadius: '50%',
                                                    width: '18px', height: '18px', fontSize: '0.7rem',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold'
                                                }}>
                                                    {totalUnread}
                                                </span>
                                            )}
                                        </button>
                                        {showNotifications && (
                                            <div style={{
                                                position: 'absolute', top: '110%', right: 0, width: '380px',
                                                background: 'white', boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
                                                borderRadius: '12px', zIndex: 9999, border: '1px solid #eee',
                                                maxHeight: '480px', overflowY: 'auto'
                                            }}>
                                                {/* Header */}
                                                <div style={{ padding: '14px 16px', borderBottom: '2px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa', borderRadius: '12px 12px 0 0' }}>
                                                    <strong style={{ color: '#2c3e50', fontSize: '0.95rem' }}>🔔 Alerts Center</strong>
                                                    <button
                                                        onClick={() => { setBreakdownAlerts([]); setFuelAlerts([]); setShowNotifications(false); }}
                                                        style={{ background: '#ecf0f1', border: 'none', color: '#777', cursor: 'pointer', fontSize: '0.75rem', padding: '4px 10px', borderRadius: 20 }}
                                                    >Clear All</button>
                                                </div>

                                                {/* Breakdown Alerts Section */}
                                                {breakdownAlerts.length > 0 && (
                                                    <div>
                                                        <div style={{ padding: '8px 16px', background: '#fff5f5', fontSize: '0.75rem', fontWeight: 700, color: '#e74c3c', textTransform: 'uppercase', letterSpacing: 1 }}>🚨 Breakdowns ({breakdownAlerts.filter(a => !a.dismissed).length})</div>
                                                        {breakdownAlerts.map(alert => (
                                                            <div key={alert.id} style={{
                                                                padding: '12px 16px', borderBottom: '1px solid #f5f5f5',
                                                                background: alert.dismissed ? '#fafafa' : '#fff5f5',
                                                                opacity: alert.dismissed ? 0.6 : 1
                                                            }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                                    <div style={{ flex: 1 }}>
                                                                        <div style={{ fontWeight: 'bold', color: '#e74c3c', marginBottom: 3, fontSize: '0.88rem' }}>🚨 {alert.driverName} — Breakdown!</div>
                                                                        <div style={{ fontSize: '0.8rem', color: '#555' }}>{alert.reassignedCount} deliveries → <strong>{alert.assignedTo}</strong></div>
                                                                        {alert.location && (
                                                                            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: 2 }}>📍 {alert.location[0]?.toFixed(4)}, {alert.location[1]?.toFixed(4)}</div>
                                                                        )}
                                                                        <div style={{ fontSize: '0.72rem', color: '#aaa', marginTop: 3 }}>⏰ {alert.time}</div>
                                                                    </div>
                                                                    <button onClick={() => setBreakdownAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, dismissed: true } : a))}
                                                                        style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '1.1rem', padding: '0 0 0 8px' }}>✕</button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Fuel Alerts Section */}
                                                {fuelAlerts.length > 0 && (
                                                    <div>
                                                        <div style={{ padding: '8px 16px', background: '#fff8e1', fontSize: '0.75rem', fontWeight: 700, color: '#e67e22', textTransform: 'uppercase', letterSpacing: 1 }}>⛽ Low Fuel Alerts ({fuelAlerts.filter(a => !a.dismissed).length})</div>
                                                        {fuelAlerts.map(alert => (
                                                            <div key={alert.id} style={{
                                                                padding: '12px 16px', borderBottom: '1px solid #f5f5f5',
                                                                background: alert.dismissed ? '#fafafa' : '#fff8e1',
                                                                opacity: alert.dismissed ? 0.6 : 1
                                                            }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                    <div>
                                                                        <div style={{ fontWeight: 700, color: '#e67e22', fontSize: '0.88rem' }}>⛽ {alert.driverName} — Low Fuel!</div>
                                                                        <div style={{ fontSize: '0.8rem', color: '#555', marginTop: 2 }}>Fuel level: <strong style={{ color: alert.fuelLevel <= 10 ? '#e74c3c' : '#e67e22' }}>{alert.fuelLevel}%</strong> — Driver must refuel</div>
                                                                        <div style={{ fontSize: '0.72rem', color: '#aaa', marginTop: 3 }}>⏰ {alert.time}</div>
                                                                    </div>
                                                                    <button onClick={() => setFuelAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, dismissed: true } : a))}
                                                                        style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '1.1rem', padding: '0 0 0 8px' }}>✕</button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {breakdownAlerts.length === 0 && fuelAlerts.length === 0 && (
                                                    <div style={{ padding: '30px 20px', textAlign: 'center', color: '#aaa' }}>
                                                        <div style={{ fontSize: '2rem', marginBottom: 8 }}>✅</div>
                                                        All clear — no active alerts
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </>
                                );
                            })()}
                        </div>

                        <button
                            onClick={() => setShowNewDeliverySidebar(true)}
                            style={{
                                background: '#28a745',
                                color: 'white',
                                border: 'none',
                                padding: '8px 16px',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 'bold'
                            }}
                        >
                            ➕ New Delivery
                        </button>
                        <div style={{ fontSize: '0.9rem', color: '#555', fontWeight: 'bold' }}>
                            🟢 System Online
                            {appStatus === 'generating' && <span style={{ color: '#f39c12', marginLeft: '10px' }}>⚡ AI Optimizing Routes...</span>}
                            {blockages.length > 0 && (
                                <span
                                    onClick={() => setActiveView('traffic')}
                                    title="Click to manage traffic blocks"
                                    style={{ color: '#e74c3c', marginLeft: '10px', cursor: 'pointer', fontWeight: 700, borderBottom: '1px dashed #e74c3c' }}
                                >
                                    🚧 {blockages.length} Traffic Block{blockages.length > 1 ? 's' : ''} Active
                                </span>
                            )}
                        </div>
                    </div>
                </header>

                <div style={{ padding: activeView === 'map' ? '0' : '20px', flex: 1, overflowY: activeView === 'map' ? 'hidden' : 'auto', overflow: activeView === 'map' ? 'hidden' : undefined, background: '#f4f7f6', position: 'relative' }}>

                    {/* VIEW: DASHBOARD */}
                    {activeView === 'dashboard' && (
                        <div>
                            {/* KPI grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                                {[
                                    { label: 'Total Orders', val: deliveries.length, color: '#3498db', icon: '📦' },
                                    { label: 'Completed', val: completedCount, color: '#27ae60', icon: '✅' },
                                    { label: 'Active Trucks', val: activeTrucks, color: '#9b59b6', icon: '🚚' },
                                    { label: 'Active Bikes', val: activeBikes, color: '#f39c12', icon: '🏍' },
                                    { label: 'Revenue', val: `₹${totalRevenue}`, color: '#e74c3c', icon: '💰' },
                                    { label: 'Routes Reoptimized', val: reoptimizeCount, color: '#1abc9c', icon: '🔄' },
                                ].map(k => (
                                    <div key={k.label} style={{ background: 'white', borderRadius: 12, padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderLeft: `4px solid ${k.color}` }}>
                                        <div style={{ fontSize: '1.5rem' }}>{k.icon}</div>
                                        <div style={{ fontSize: '1.8rem', fontWeight: 800, color: k.color, marginTop: 4 }}>{k.val}</div>
                                        <div style={{ fontSize: '0.78rem', color: '#888', marginTop: 4 }}>{k.label}</div>
                                    </div>
                                ))}
                            </div>

                            {/* SLA Breach Alert */}
                            {slaBreachList.length > 0 && (
                                <div style={{ background: '#fff5f5', border: '2px solid #e74c3c', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                        <span style={{ fontSize: '1.3rem' }}>🚨</span>
                                        <strong style={{ color: '#c0392b', fontSize: '1rem' }}>SLA Breach Alert — {slaBreachList.length} overdue {slaBreachList.length === 1 ? 'delivery' : 'deliveries'}</strong>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {slaBreachList.slice(0, 5).map(d => (
                                            <div key={d._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '8px 12px', borderRadius: 8 }}>
                                                <div>
                                                    <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{d.customerName}</span>
                                                    {d.emergency && <span style={{ marginLeft: 6, background: '#e74c3c', color: 'white', fontSize: '0.65rem', padding: '1px 6px', borderRadius: 20, fontWeight: 700 }}>URGENT</span>}
                                                    <span style={{ fontSize: '0.75rem', color: '#888', marginLeft: 8 }}>Deadline: {d.deadline} min after 8AM</span>
                                                </div>
                                                <span style={{ fontSize: '0.78rem', padding: '3px 10px', borderRadius: 20, background: '#fde8e8', color: '#e74c3c', fontWeight: 700 }}>{d.status}</span>
                                            </div>
                                        ))}
                                        {slaBreachList.length > 5 && <div style={{ fontSize: '0.8rem', color: '#888', textAlign: 'center' }}>+{slaBreachList.length - 5} more</div>}
                                    </div>
                                </div>
                            )}

                            {/* Driver Performance */}
                            {driverPerfMap.length > 0 && (
                                <div style={{ background: 'white', borderRadius: 12, padding: '18px 20px', marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                                    <h4 style={{ margin: '0 0 14px', color: '#2c3e50' }}>📊 Driver Performance</h4>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        {driverPerfMap.map(({ driver, dDelivered, dFailed, dTotal, successRate }) => (
                                            <div key={driver._id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg,#3b82f6,#6366f1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: '0.9rem', flexShrink: 0 }}>
                                                    {driver.name?.charAt(0)?.toUpperCase()}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                                        <span style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{driver.name}</span>
                                                        <span style={{ fontSize: '0.78rem', color: successRate >= 80 ? '#27ae60' : successRate >= 50 ? '#f39c12' : '#e74c3c', fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>{successRate}%</span>
                                                    </div>
                                                    <div style={{ height: 6, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                                                        <div style={{ height: '100%', background: successRate >= 80 ? '#27ae60' : successRate >= 50 ? '#f39c12' : '#e74c3c', width: `${successRate}%`, borderRadius: 99, transition: 'width 0.6s ease' }} />
                                                    </div>
                                                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 3 }}>{dDelivered} delivered · {dFailed} failed · {dTotal} total</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="panel">
                                <h3>Quick Actions</h3>
                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                    <button onClick={() => setActiveView('map')} style={{ background: '#3498db' }}>View Live Map</button>
                                    <button onClick={() => setActiveView('traffic')} style={{ background: '#e74c3c' }}>🚧 Traffic Jams</button>
                                    <button onClick={() => setWarehouseModalOpen(true)} style={{ background: '#8e44ad' }}>Check Inventory</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* VIEW: TRAFFIC JAMS */}
                    {activeView === 'traffic' && (
                        <div className="panel">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                <h3 style={{ margin: 0 }}>🚧 Traffic Jam Management</h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                    {/* Auto-reoptimize toggle */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: autoReoptimize ? '#e8f5e9' : '#fafafa', border: `1px solid ${autoReoptimize ? '#c3e6cb' : '#dee2e6'}`, borderRadius: 20, padding: '6px 14px' }}>
                                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: autoReoptimize ? '#27ae60' : '#888' }}>⚡ Auto-Reoptimize</span>
                                        <div
                                            onClick={() => setAutoReoptimize(v => !v)}
                                            style={{ width: 40, height: 22, background: autoReoptimize ? '#27ae60' : '#ccc', borderRadius: 99, position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}
                                        >
                                            <div style={{ position: 'absolute', top: 2, left: autoReoptimize ? 20 : 2, width: 18, height: 18, background: 'white', borderRadius: '50%', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }} />
                                        </div>
                                    </div>
                                    {reoptimizeCount > 0 && (
                                        <div style={{ fontSize: '0.78rem', background: '#e8f5e9', color: '#27ae60', padding: '5px 12px', borderRadius: 20, fontWeight: 700 }}>
                                            🔄 {reoptimizeCount} reoptimization{reoptimizeCount > 1 ? 's' : ''} today
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                                {/* Active blocks list */}
                                <div className="panel" style={{ background: '#fff8f0', border: '2px solid #f39c12' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                                        <h4 style={{ margin: 0, color: '#e67e22' }}>🛑 Active Blocks {blockages.length > 0 && <span style={{ background: '#e74c3c', color: 'white', fontSize: '0.72rem', padding: '2px 8px', borderRadius: 20, marginLeft: 6 }}>{blockages.length}</span>}</h4>
                                        {!autoReoptimize && blockages.length > 0 && (
                                            <button
                                                onClick={handleManualReoptimize}
                                                disabled={appStatus !== 'ready'}
                                                style={{ background: '#27ae60', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' }}
                                            >
                                                {appStatus === 'generating' ? '⏳ Optimizing...' : '🔄 Reoptimize Now'}
                                            </button>
                                        )}
                                    </div>
                                    {blockages.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '20px 0', color: '#856404' }}>
                                            <div style={{ fontSize: '2rem', marginBottom: 8 }}>🛣️</div>
                                            <p>No traffic jams — all roads clear</p>
                                            <p style={{ fontSize: '0.8rem', marginTop: 4 }}>Go to Map View → click 🚧 to add a block</p>
                                        </div>
                                    ) : (
                                        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            {blockages.map((block, idx) => (
                                                <li key={idx} style={{ padding: '10px 14px', background: 'white', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #fdebd0' }}>
                                                    <div>
                                                        <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#e67e22' }}>🛑 Block #{idx + 1}</div>
                                                        <div style={{ fontSize: '0.75rem', color: '#888', marginTop: 2 }}>📍 {block.lat.toFixed(5)}, {block.lng.toFixed(5)}</div>
                                                    </div>
                                                    <button
                                                        onClick={async () => {
                                                            const updated = blockages.filter((_, i) => i !== idx);
                                                            setBlockages(updated);
                                                            if (autoReoptimize && updated.length >= 0) {
                                                                setAppStatus('generating');
                                                                try {
                                                                    await axios.post(`${BACKEND_URL}/api/schedule`, { algorithm, blockages: updated.map(b => [b.lat, b.lng]) });
                                                                    setReoptimizeCount(c => c + 1);
                                                                    setNotification({ msg: `Block removed. Routes reoptimized.`, isError: false });
                                                                    fetchData();
                                                                } catch (e) { /* silent */ } finally { setAppStatus('ready'); }
                                                            }
                                                        }}
                                                        style={{ background: 'none', border: '1px solid #e74c3c', color: '#e74c3c', padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                                                    >
                                                        ✕ Remove
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    {blockages.length > 0 && (
                                        <button
                                            onClick={async () => {
                                                setBlockages([]);
                                                if (autoReoptimize) {
                                                    setAppStatus('generating');
                                                    try {
                                                        await axios.post(`${BACKEND_URL}/api/schedule`, { algorithm, blockages: [] });
                                                        setReoptimizeCount(c => c + 1);
                                                        setNotification({ msg: '✅ All blocks cleared. Routes restored.', isError: false });
                                                        fetchData();
                                                    } catch (e) { /* silent */ } finally { setAppStatus('ready'); }
                                                }
                                            }}
                                            style={{ marginTop: '14px', background: '#e74c3c', color: 'white', border: 'none', padding: '12px', width: '100%', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}
                                        >
                                            🗑️ Clear All Blocks
                                        </button>
                                    )}
                                </div>

                                <div className="panel" style={{ background: '#d1ecf1', border: '1px solid #bee5eb' }}>
                                    <h4>Route Impact Analysis</h4>
                                    {comparisonData ? (
                                        <div>
                                            {comparisonData.driverName && <div style={{ marginBottom: 10, background: '#bee5eb', padding: '6px 10px', borderRadius: 6, fontSize: '0.82rem', fontWeight: 700 }}>Driver: {comparisonData.driverName}</div>}
                                            <div style={{ marginBottom: '15px' }}>
                                                <h5 style={{ color: '#0c5460' }}>Original Stop Order (ORS)</h5>
                                                <p>Distance: {comparisonData.algo_2?.distance || 'N/A'}</p>
                                                <p>Duration: {comparisonData.algo_2?.duration || 'N/A'}</p>
                                                <p>Fuel: {comparisonData.algo_2?.fuel || 'N/A'}</p>
                                                {comparisonData.isEV && <p>EV Energy: {comparisonData.algo_2?.ev_energy || 'N/A'}</p>}
                                            </div>
                                            <div style={{ marginBottom: '15px' }}>
                                                <h5 style={{ color: '#0c5460' }}>AI Optimized Route (ORS)</h5>
                                                <p>Distance: {comparisonData.algo_1?.distance || 'N/A'}</p>
                                                <p>Duration: {comparisonData.algo_1?.duration || 'N/A'}</p>
                                                <p>Fuel: {comparisonData.algo_1?.fuel || 'N/A'}</p>
                                                {comparisonData.isEV && <p>EV Energy: {comparisonData.algo_1?.ev_energy || 'N/A'}</p>}
                                            </div>
                                            <div style={{ background: '#bee5eb', padding: '10px', borderRadius: '5px' }}>
                                                <strong>Time Saved: {comparisonData.algo_1?.saved || 'N/A'}</strong><br />
                                                {comparisonData.isEV && <><strong>Energy Saved: {comparisonData.algo_1?.ev_energy_saved || 'N/A'}</strong><br /></>}
                                                {comparisonData.isEV && <strong>Range Saved: {comparisonData.algo_1?.ev_range_saved || 'N/A'}</strong>}
                                            </div>
                                            <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#0c5460', fontStyle: 'italic' }}>✅ Both metrics use ORS real road distance for a fair comparison.</div>
                                        </div>
                                    ) : (
                                        <p style={{ color: '#0c5460' }}>Select a driver and run comparison</p>
                                    )}
                                </div>

                                <div className="panel" style={{ background: '#d4edda', border: '1px solid #c3e6cb' }}>
                                    <h4>EV Vehicle Impact</h4>
                                    {comparisonData && comparisonData.isEV ? (
                                        <div>
                                            <p><strong>Original Range Used:</strong> {comparisonData.algo_2?.ev_range_used || 'N/A'}</p>
                                            <p><strong>Optimized Range Used:</strong> {comparisonData.algo_1?.ev_range_used || 'N/A'}</p>
                                            <p><strong>Range Saved:</strong> {comparisonData.algo_1?.ev_range_saved || 'N/A'}</p>
                                            <div style={{ background: '#c3e6cb', padding: '10px', borderRadius: '5px', marginTop: '10px' }}>
                                                <strong>⚡ EV Efficiency: {comparisonData.summary?.ev_efficiency || 'See saved values above'}</strong>
                                            </div>
                                        </div>
                                    ) : (
                                        <p style={{ color: '#155724' }}>{comparisonData ? '🚚 Non-EV vehicle — fuel savings shown in panel above.' : 'Select an EV driver to see battery impact.'}</p>
                                    )}
                                </div>
                            </div>

                            <div style={{ marginTop: '20px', textAlign: 'center' }}>
                                <button
                                    onClick={() => { setActiveView('map'); setIsTrafficMode(true); }}
                                    style={{ background: '#e74c3c', color: 'white', border: 'none', padding: '15px 30px', borderRadius: '5px', fontSize: '1.1rem', marginRight: '10px' }}
                                >
                                    🚧 Add Traffic Blocks on Map
                                </button>
                                <button
                                    onClick={handleCompare}
                                    style={{ background: '#3498db', color: 'white', border: 'none', padding: '15px 30px', borderRadius: '5px', fontSize: '1.1rem' }}
                                >
                                    📊 Run Route Comparison
                                </button>
                            </div>
                        </div>
                    )}

                    {/* VIEW: ROUTE COMPARISON */}
                    {activeView === 'comparison' && (
                        <div>
                            {/* ── Header ── */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                                <div>
                                    <h3 style={{ margin: 0 }}>📊 Per-Driver Route Comparison</h3>
                                    <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#888' }}>Both "Previous" and "Optimized" use ORS real road distance — a mathematically fair comparison.</p>
                                </div>
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <select
                                        value={comparisonDriverId}
                                        onChange={e => { setComparisonDriverId(e.target.value); setComparisonData(null); }}
                                        style={{ padding: '9px 14px', border: '2px solid #9b59b6', borderRadius: 8, fontSize: '0.88rem', fontWeight: 600, color: '#2c3e50', outline: 'none', minWidth: 200 }}
                                    >
                                        <option value="">— Select Driver —</option>
                                        {drivers.filter(d => !d.isAvailable).map(d => (
                                            <option key={d._id} value={d._id}>{d.name} ({d.vehicleType})</option>
                                        ))}
                                        {drivers.filter(d => !d.isAvailable).length === 0 && (
                                            <option value="" disabled>No on-route drivers</option>
                                        )}
                                    </select>
                                    <button
                                        onClick={() => handleCompare(comparisonDriverId)}
                                        disabled={comparisonLoading || !comparisonDriverId}
                                        style={{
                                            background: comparisonLoading || !comparisonDriverId ? '#bdc3c7' : '#9b59b6',
                                            color: 'white', border: 'none', padding: '10px 22px',
                                            borderRadius: 8, fontSize: '0.92rem', fontWeight: 700,
                                            cursor: comparisonLoading || !comparisonDriverId ? 'not-allowed' : 'pointer'
                                        }}
                                    >
                                        {comparisonLoading ? '⏳ Computing ORS…' : '📊 Run Comparison'}
                                    </button>
                                    {comparisonData && (
                                        <button
                                            onClick={() => { setComparisonData(null); }}
                                            style={{ background: '#ecf0f1', color: '#555', border: 'none', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontSize: '0.82rem' }}
                                        >
                                            ✕ Clear
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* ── Loading state ── */}
                            {comparisonLoading && (
                                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                                    <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🛣️</div>
                                    <div style={{ fontWeight: 700, color: '#9b59b6', fontSize: '1.05rem' }}>Fetching ORS road routes for both orderings…</div>
                                    <div style={{ fontSize: '0.82rem', color: '#888', marginTop: 6 }}>This ensures both Previous and Optimized use identical road-distance metrics.</div>
                                </div>
                            )}

                            {/* Empty state — only when not loading AND no data */}
                            {!comparisonLoading && !comparisonData && (
                                <div className="panel" style={{ textAlign: 'center', padding: '50px' }}>
                                    <div style={{ fontSize: '3rem', marginBottom: 12 }}>📊</div>
                                    <h4>Select a Driver to Begin Comparison</h4>
                                    <p style={{ color: '#888', maxWidth: 420, margin: '10px auto' }}>Choose an on-route driver from the dropdown above and click "Run Comparison" to see their previous stop order vs. AI-optimized order — both measured by ORS real road distance.</p>
                                    {drivers.filter(d => !d.isAvailable).length === 0 && (
                                        <div style={{ marginTop: 20, padding: '14px 20px', background: '#fff3cd', border: '1px solid #ffe082', borderRadius: 8, color: '#856404', fontSize: '0.88rem' }}>
                                            ⚠️ No drivers are currently on route. Generate a schedule first from the Map view.
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
                                        <button onClick={() => setActiveView('map')} style={{ background: '#3498db', color: 'white', border: 'none', padding: '12px 24px', borderRadius: 8, fontSize: '1rem', cursor: 'pointer', fontWeight: 700 }}>🗺 Go to Map View</button>
                                        <button onClick={() => handleCompare('')} style={{ background: '#28a745', color: 'white', border: 'none', padding: '12px 24px', borderRadius: 8, fontSize: '1rem', cursor: 'pointer', fontWeight: 700 }}>⚡ Auto-Select & Compare</button>
                                    </div>
                                </div>
                            )}

                            {/* Data state — ONLY renders when comparisonData is non-null (prevents null-property crash) */}
                            {!comparisonLoading && comparisonData && (
                                <div style={{ display: 'flex', gap: '20px', height: '70vh' }}>
                                    {/* Left Map - Previous Route */}
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                        <h4 style={{ textAlign: 'center', color: '#e74c3c', margin: '0 0 10px 0' }}>Previous Route</h4>
                                        <div className="map-container" style={{ flex: 1, borderRadius: '8px', overflow: 'hidden', border: '2px solid #e74c3c' }}>
                                            <MapContainer center={WAREHOUSE_COORDS} zoom={12} style={{ height: '100%' }}>
                                                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                                                <MapRecenter
                                                    center={WAREHOUSE_COORDS}
                                                    zoom={12}
                                                    bounds={comparisonData && comparisonData.algo_2 && comparisonData.algo_2.polyline ? parsePolyline(comparisonData.algo_2.polyline) : null}
                                                />

                                                <Marker position={WAREHOUSE_COORDS} icon={warehouseIcon}><Popup>Central Warehouse</Popup></Marker>

                                                {/* Traffic Blockages */}
                                                {blockages.map((b, idx) => (
                                                    <Circle key={idx} center={b} pathOptions={{ color: 'red', fillColor: 'red', fillOpacity: 0.5 }} radius={300}>
                                                        <Popup>⛔ TRAFFIC JAM REPORTED</Popup>
                                                    </Circle>
                                                ))}

                                                {/* Deliveries */}
                                                {deliveries.filter(d => d.status === 'assigned').map(d => (
                                                    <Marker key={d._id} position={[d.pickupLocation.coordinates[1], d.pickupLocation.coordinates[0]]} icon={createDeliveryIcon(d.status)}>
                                                        <Popup>
                                                            <strong>{d.customerName}</strong><br />
                                                            Status: {d.status}
                                                        </Popup>
                                                    </Marker>
                                                ))}

                                                {/* Previous Route - Gray */}
                                                {comparisonData && comparisonData.algo_2 && comparisonData.algo_2.polyline && parsePolyline(comparisonData.algo_2.polyline) && (
                                                    <Polyline
                                                        positions={parsePolyline(comparisonData.algo_2.polyline)}
                                                        color="#6c757d"
                                                        weight={4}
                                                        opacity={0.7}
                                                        dashArray="5, 10"
                                                        interactive={false}
                                                    >
                                                        <Popup>
                                                            Previous Route<br />
                                                            Distance: {comparisonData.algo_2.distance}<br />
                                                            Time: {comparisonData.algo_2.duration}<br />
                                                            Fuel: {comparisonData.algo_2.fuel}
                                                        </Popup>
                                                    </Polyline>
                                                )}
                                            </MapContainer>
                                        </div>
                                    </div>

                                    {/* Right Map - New Optimized Route */}
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                        <h4 style={{ textAlign: 'center', color: '#27ae60', margin: '0 0 10px 0' }}>Optimized Route</h4>
                                        <div className="map-container" style={{ flex: 1, borderRadius: '8px', overflow: 'hidden', border: '2px solid #27ae60' }}>
                                            <MapContainer center={WAREHOUSE_COORDS} zoom={12} style={{ height: '100%' }}>
                                                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                                                <MapRecenter
                                                    center={WAREHOUSE_COORDS}
                                                    zoom={12}
                                                    bounds={comparisonData && comparisonData.algo_1 && comparisonData.algo_1.polyline ? parsePolyline(comparisonData.algo_1.polyline) : null}
                                                />

                                                <Marker position={WAREHOUSE_COORDS} icon={warehouseIcon}><Popup>Central Warehouse</Popup></Marker>

                                                {/* Traffic Blockages */}
                                                {blockages.map((b, idx) => (
                                                    <Circle key={idx} center={b} pathOptions={{ color: 'red', fillColor: 'red', fillOpacity: 0.5 }} radius={300}>
                                                        <Popup>⛔ TRAFFIC JAM REPORTED</Popup>
                                                    </Circle>
                                                ))}

                                                {/* Deliveries */}
                                                {deliveries.filter(d => d.status === 'assigned').map(d => (
                                                    <Marker key={d._id} position={[d.pickupLocation.coordinates[1], d.pickupLocation.coordinates[0]]} icon={createDeliveryIcon(d.status)}>
                                                        <Popup>
                                                            <strong>{d.customerName}</strong><br />
                                                            Status: {d.status}
                                                        </Popup>
                                                    </Marker>
                                                ))}

                                                {/* New Optimized Route - Green */}
                                                {comparisonData && comparisonData.algo_1 && comparisonData.algo_1.polyline && parsePolyline(comparisonData.algo_1.polyline) && (
                                                    <Polyline
                                                        positions={parsePolyline(comparisonData.algo_1.polyline)}
                                                        color="#27ae60"
                                                        weight={5}
                                                        interactive={false}
                                                    >
                                                        <Popup>
                                                            Optimized Route<br />
                                                            Distance: {comparisonData.algo_1.distance}<br />
                                                            Time: {comparisonData.algo_1.duration}<br />
                                                            Fuel: {comparisonData.algo_1.fuel}
                                                        </Popup>
                                                    </Polyline>
                                                )}
                                            </MapContainer>
                                        </div>
                                    </div>

                                    {/* Comparison Stats */}
                                    <div style={{ width: '380px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', maxHeight: '70vh', paddingRight: '4px' }}>
                                        {/* Distance disclaimer */}
                                        <div style={{ background: '#e8f4f8', border: '1px solid #b8dde8', borderRadius: 10, padding: '10px 14px', fontSize: '0.8rem', color: '#1a6a7a' }}>
                                            <strong>✅ ORS-Normalised Comparison:</strong> Both "Original" and "AI Optimized" routes are calculated using <strong>OpenRouteService real road distance</strong> — so the distance, time, and fuel figures use identical measurement units. What truly differs is the stop <em>ordering</em> chosen by the AI.
                                        </div>

                                        <div className="panel" style={{ background: '#f8f9fa', padding: '16px' }}>
                                            {/* Determine if time was actually saved */}
                                            {(() => {
                                                const savedStr = comparisonData.algo_1?.saved || '';
                                                const savedNum = parseFloat(savedStr);
                                                const timeSaved = !isNaN(savedNum) && savedNum > 0;
                                                return (
                                                    <>
                                                        <h4 style={{ margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            Route Metrics
                                                            {timeSaved ? <span style={{ background: '#e8f5e9', color: '#27ae60', fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20, fontWeight: 700 }}>✅ TIME OPTIMIZED</span> : <span style={{ background: '#fff3cd', color: '#e67e22', fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20, fontWeight: 700 }}>⚠ SIMILAR TIME</span>}
                                                        </h4>
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                                            <div style={{ padding: '14px', background: 'white', borderRadius: 10, border: '2px solid #e74c3c' }}>
                                                                <div style={{ fontWeight: 700, color: '#e74c3c', marginBottom: 10, fontSize: '0.88rem' }}>📍 Original Stop Order</div>
                                                                <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 8, fontStyle: 'italic' }}>Current delivery order · ORS real roads</div>
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                                    <div><span style={{ fontSize: '0.78rem', color: '#888' }}>Distance</span><br /><strong style={{ color: '#e74c3c' }}>{comparisonData.algo_2?.distance || 'N/A'}</strong></div>
                                                                    <div><span style={{ fontSize: '0.78rem', color: '#888' }}>Time</span><br /><strong style={{ color: '#e74c3c' }}>{comparisonData.algo_2?.duration || 'N/A'}</strong></div>
                                                                    <div><span style={{ fontSize: '0.78rem', color: '#888' }}>Fuel</span><br /><strong>{comparisonData.algo_2?.fuel || 'N/A'}</strong></div>
                                                                </div>
                                                            </div>
                                                            <div style={{ padding: '14px', background: 'white', borderRadius: 10, border: `2px solid ${timeSaved ? '#27ae60' : '#f39c12'}` }}>
                                                                <div style={{ fontWeight: 700, color: timeSaved ? '#27ae60' : '#e67e22', marginBottom: 10, fontSize: '0.88rem' }}>🤖 AI Optimized</div>
                                                                <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 8, fontStyle: 'italic' }}>Real road dist. (ORS)</div>
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                                    <div><span style={{ fontSize: '0.78rem', color: '#888' }}>Distance</span><br /><strong style={{ color: '#888' }}>{comparisonData.algo_1?.distance || 'N/A'} <span style={{ fontSize: '0.68rem', color: '#aaa' }}>(road)</span></strong></div>
                                                                    <div><span style={{ fontSize: '0.78rem', color: '#888' }}>Time</span><br /><strong style={{ color: timeSaved ? '#27ae60' : '#e67e22' }}>{comparisonData.algo_1?.duration || 'N/A'}</strong></div>
                                                                    <div><span style={{ fontSize: '0.78rem', color: '#888' }}>Fuel</span><br /><strong>{comparisonData.algo_1?.fuel || 'N/A'}</strong></div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div style={{ marginTop: 14, padding: 14, background: timeSaved ? '#e8f5e9' : '#fffde7', borderRadius: 10, border: `1px solid ${timeSaved ? '#c3e6cb' : '#ffe082'}` }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                                                                <div style={{ textAlign: 'center' }}>
                                                                    <div style={{ fontSize: '0.72rem', color: '#888' }}>Time Saved</div>
                                                                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: timeSaved ? '#27ae60' : '#e67e22' }}>{savedStr || 'N/A'}</div>
                                                                </div>
                                                                {comparisonData.isEV && (
                                                                  <div style={{ textAlign: 'center' }}>
                                                                    <div style={{ fontSize: '0.72rem', color: '#888' }}>EV Energy Saved</div>
                                                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#3498db' }}>{comparisonData.algo_1?.ev_energy_saved || 'N/A'}</div>
                                                                  </div>
                                                                )}
                                                                {comparisonData.isEV && (
                                                                  <div style={{ textAlign: 'center' }}>
                                                                    <div style={{ fontSize: '0.72rem', color: '#888' }}>EV Range Saved</div>
                                                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#9b59b6' }}>{comparisonData.algo_1?.ev_range_saved || 'N/A'}</div>
                                                                  </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </>
                                                );
                                            })()}
                                        </div>

                                        {comparisonData.isEV ? (
                                          <div className="panel" style={{ background: '#e8f4fd' }}>
                                            <h4>🚗 EV Vehicle Analysis</h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <span>Original Energy:</span><span>{comparisonData.algo_2?.ev_energy || 'N/A'}</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <span>Optimized Energy:</span><span>{comparisonData.algo_1?.ev_energy || 'N/A'}</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <span>Original Range Used:</span><span>{comparisonData.algo_2?.ev_range_used || 'N/A'}</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <span>Optimized Range Used:</span><span>{comparisonData.algo_1?.ev_range_used || 'N/A'}</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#27ae60' }}>
                                                    <span>Energy Saved:</span><span>{comparisonData.algo_1?.ev_energy_saved || 'N/A'}</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#27ae60' }}>
                                                    <span>Range Saved:</span><span>{comparisonData.algo_1?.ev_range_saved || 'N/A'}</span>
                                                </div>
                                                <div style={{ marginTop: '10px', padding: '8px', background: '#c8e6c9', borderRadius: '3px', textAlign: 'center' }}>
                                                    <strong>⚡ EV Efficiency: {comparisonData.summary?.ev_efficiency || 'N/A'}</strong>
                                                </div>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="panel" style={{ background: '#f8f9fa', border: '1px solid #dee2e6' }}>
                                            <h4>🚗 Vehicle Type</h4>
                                            <div style={{ textAlign: 'center', padding: '18px 12px' }}>
                                                <div style={{ fontSize: '2rem', marginBottom: 8 }}>🏍️</div>
                                                <div style={{ fontWeight: 700, color: '#555', marginBottom: 6 }}>{comparisonData.driverName} · {drivers.find(d => String(d._id) === String(comparisonData.driverId))?.vehicleType || 'Non-EV'}</div>
                                                <div style={{ fontSize: '0.82rem', color: '#888', lineHeight: 1.5 }}>
                                                    Fuel vehicle — EV battery metrics are not applicable.<br />
                                                    Fuel savings are shown in the Route Metrics panel above.
                                                </div>
                                            </div>
                                          </div>
                                        )}


                                        <div className="panel" style={{ background: '#fff3cd' }}>
                                            <h4>📍 Route Details</h4>
                                            <p><strong>Traffic Blocks:</strong> {blockages.length}</p>
                                            <p><strong>Deliveries:</strong> {deliveries.filter(d => d.status === 'assigned').length}</p>
                                            <p><strong>Active Drivers:</strong> {drivers.filter(d => !d.isAvailable).length}</p>
                                            <button
                                                onClick={handleGenerateSchedule}
                                                style={{ marginTop: '15px', width: '100%', background: '#28a745', color: 'white', border: 'none', padding: '12px', borderRadius: '5px' }}
                                                disabled={appStatus !== 'ready'}
                                            >
                                                {appStatus === 'generating' ? 'Optimizing...' : 'Apply Optimized Routes'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}


                    {/* VIEW: DELIVERIES */}
                    {activeView === 'deliveries' && (
                        <div className="panel">
                            <h3>Master Delivery Manifest</h3>
                            <div style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
                                <table className="history-table">
                                    <thead><tr><th>Customer</th><th>Area</th><th>Emergency</th><th>Zone</th><th>Weight</th><th>Size</th><th>Deadline</th><th>Status</th><th>Driver</th><th>Action</th></tr></thead>
                                    <tbody>
                                        {deliveries.map(d => (
                                            <tr key={d._id}>
                                                <td>
                                                    <strong>{d.customerName}</strong><br />
                                                    <span style={{ fontSize: '0.8rem', color: '#777' }}>{d.customerPhone}</span>
                                                </td>
                                                <td>{d.area || 'N/A'}</td>
                                                <td>
                                                    {d.emergency ? (
                                                        <span style={{ color: '#e74c3c', fontWeight: 'bold' }}>🚨 EMERGENCY</span>
                                                    ) : (
                                                        <span style={{ color: '#27ae60' }}>Normal</span>
                                                    )}
                                                </td>
                                                <td>{d.zone}</td>
                                                <td>{d.weight || 5} kg</td>
                                                <td>
                                                    <span style={{
                                                        background: d.size === 'small' ? '#27ae60' : d.size === 'medium' ? '#f39c12' : '#e74c3c',
                                                        color: 'white',
                                                        padding: '2px 6px',
                                                        borderRadius: '3px',
                                                        fontSize: '0.8rem'
                                                    }}>
                                                        {(d.size && typeof d.size === 'string') ? d.size.toUpperCase() : 'MEDIUM'}
                                                    </span>
                                                </td>
                                                <td>{d.deadline || 480} min</td>
                                                <td><span className={`badge ${d.status}`}>{d.status.toUpperCase()}</span></td>
                                                <td>{d.assignedDriver ? d.assignedDriver.name : "Unassigned"}</td>
                                                <td><button onClick={() => handleDeleteDelivery(d._id)} style={{ background: '#e74c3c', padding: '5px 10px', fontSize: '0.8rem' }}>Delete</button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* VIEW: DRIVERS — Card-Based Control Panel */}
                    {activeView === 'drivers' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                <h3 style={{ margin: 0 }}>🚛 Driver Control Panel</h3>
                                <div style={{ display: 'flex', gap: 10 }}>
                                    <span style={{ padding: '6px 14px', background: '#e8f5e9', borderRadius: 20, fontSize: '0.85rem', color: '#27ae60', fontWeight: 600 }}>
                                        ● {drivers.filter(d => d.isAvailable).length} Available
                                    </span>
                                    <span style={{ padding: '6px 14px', background: '#fff3e0', borderRadius: 20, fontSize: '0.85rem', color: '#f39c12', fontWeight: 600 }}>
                                        🚚 {drivers.filter(d => !d.isAvailable).length} On Route
                                    </span>
                                    {breakdownAlerts.filter(a => !a.dismissed).length > 0 && (
                                        <span style={{ padding: '6px 14px', background: '#ffebee', borderRadius: 20, fontSize: '0.85rem', color: '#e74c3c', fontWeight: 600 }}>
                                            🚨 {breakdownAlerts.filter(a => !a.dismissed).length} Breakdown(s)
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Active Breakdown Alerts Panel */}
                            {breakdownAlerts.filter(a => !a.dismissed).length > 0 && (
                                <div style={{ marginBottom: 20, padding: '16px 20px', background: '#fff5f5', border: '2px solid #e74c3c', borderRadius: 10 }}>
                                    <h4 style={{ margin: '0 0 12px 0', color: '#e74c3c' }}>🚨 Active Breakdown Alerts</h4>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {breakdownAlerts.filter(a => !a.dismissed).map(alert => (
                                            <div key={alert.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'white', borderRadius: 8, border: '1px solid #ffcdd2' }}>
                                                <div>
                                                    <strong style={{ color: '#e74c3c' }}>{alert.driverName}</strong>
                                                    <span style={{ color: '#555', marginLeft: 10, fontSize: '0.9rem' }}>→ {alert.reassignedCount} deliveries reassigned to {alert.assignedTo}</span>
                                                    <span style={{ color: '#aaa', marginLeft: 10, fontSize: '0.8rem' }}>@ {alert.time}</span>
                                                </div>
                                                <button
                                                    onClick={() => setBreakdownAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, dismissed: true } : a))}
                                                    style={{ background: '#e74c3c', color: 'white', border: 'none', padding: '4px 12px', borderRadius: 6, cursor: 'pointer' }}
                                                >Dismiss</button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Driver Cards */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 18, maxHeight: 'calc(100vh - 250px)', overflowY: 'auto', paddingRight: 6 }}>
                                {drivers.map(d => {
                                    const isBrokenDown = d.vehicleStatus === 'broken_down';
                                    const driverDeliveries = deliveries.filter(del =>
                                        del.assignedDriver === d._id || del.assignedDriver?._id === d._id
                                    );
                                    const driverRoute = routes.find(r => r.driverId === d._id || r.driver?._id === d._id);
                                    const fuel = typeof d.fuelLevel === 'number' ? d.fuelLevel : 100;
                                    const fuelColor = fuel < 20 ? '#e74c3c' : fuel < 40 ? '#f39c12' : '#27ae60';
                                    return (
                                        <div key={d._id} style={{
                                            background: 'white', borderRadius: 12, padding: 20,
                                            boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                                            border: isBrokenDown ? '2px solid #e74c3c' : d.isAvailable ? '2px solid #27ae60' : '2px solid #f39c12',
                                            position: 'relative', overflow: 'hidden'
                                        }}>
                                            {/* Status Badge */}
                                            <div style={{
                                                position: 'absolute', top: 12, right: 14,
                                                padding: '3px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700,
                                                background: isBrokenDown ? '#ffebee' : d.isAvailable ? '#e8f5e9' : '#fff3e0',
                                                color: isBrokenDown ? '#e74c3c' : d.isAvailable ? '#27ae60' : '#f39c12'
                                            }}>
                                                {isBrokenDown ? '🔴 Breakdown' : d.isAvailable ? '🟢 Available' : '🟡 On Route'}
                                            </div>

                                            {/* Driver Info */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                                                <div style={{
                                                    width: 52, height: 52, borderRadius: '50%',
                                                    background: '#3498db', color: 'white',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontSize: '1.4rem', fontWeight: 700, flexShrink: 0
                                                }}>
                                                    {d.name?.charAt(0) || '?'}
                                                </div>
                                                <div>
                                                    <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#2c3e50' }}>{d.name}</div>
                                                    <div style={{ fontSize: '0.82rem', color: '#888' }}>
                                                        {d.vehicleType} · {d.assignedZone || 'Unzoned'}
                                                    </div>
                                                    <div style={{ fontSize: '0.78rem', color: '#aaa' }}>License: {d.license || 'N/A'}</div>
                                                </div>
                                            </div>

                                            {/* Stats Row */}
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                                                <div style={{ textAlign: 'center', padding: '8px 4px', background: '#f8f9fa', borderRadius: 8 }}>
                                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#3498db' }}>{driverDeliveries.length}</div>
                                                    <div style={{ fontSize: '0.7rem', color: '#888' }}>Deliveries</div>
                                                </div>
                                                <div style={{ textAlign: 'center', padding: '8px 4px', background: '#f8f9fa', borderRadius: 8 }}>
                                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#27ae60' }}>{driverDeliveries.filter(del => del.status === 'delivered').length}</div>
                                                    <div style={{ fontSize: '0.7rem', color: '#888' }}>Delivered</div>
                                                </div>
                                                <div style={{ textAlign: 'center', padding: '8px 4px', background: '#f8f9fa', borderRadius: 8 }}>
                                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e74c3c' }}>{driverDeliveries.filter(del => ['assigned', 'in_transit'].includes(del.status)).length}</div>
                                                    <div style={{ fontSize: '0.7rem', color: '#888' }}>Pending</div>
                                                </div>
                                            </div>

                                            {/* Fuel Bar */}
                                            <div style={{ marginBottom: 14 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#666', marginBottom: 4 }}>
                                                    <span>{d.vehicleType === 'EV' ? '⚡ Battery' : '⛽ Fuel'}</span>
                                                    <span style={{ color: fuelColor, fontWeight: 600 }}>{fuel}%</span>
                                                </div>
                                                <div style={{ height: 8, background: '#ecf0f1', borderRadius: 4, overflow: 'hidden' }}>
                                                    <div style={{ height: '100%', width: `${fuel}%`, background: fuelColor, borderRadius: 4, transition: 'width 0.5s' }} />
                                                </div>
                                                <div style={{ fontSize: '0.72rem', color: '#aaa', marginTop: 2 }}>Max Range: {d.maxRange || 400} km</div>
                                            </div>

                                            {/* ETA countdown for on-route drivers */}
                                            {!d.isAvailable && driverRoute && (
                                                <div style={{ marginBottom: 10, padding: '6px 10px', background: '#e8f4fd', borderRadius: 6, fontSize: '0.78rem', color: '#2980b9', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span>⏱</span>
                                                    <span>ETA remaining: <strong>{driverRoute.totalDuration || '?'}</strong></span>
                                                    <span style={{ marginLeft: 'auto', color: '#888', fontSize: '0.72rem' }}>
                                                        {driverDeliveries.filter(del => ['assigned', 'in_transit'].includes(del.status)).length} stop(s) left
                                                    </span>
                                                </div>
                                            )}

                                            {/* Low Fuel Warning Badge (read-only — driver handles refuelling) */}
                                            {fuel <= 30 && !isBrokenDown && (
                                                <div style={{
                                                    marginBottom: 10, padding: '8px 12px',
                                                    background: fuel <= 15 ? '#ffebee' : '#fff8e1',
                                                    border: `1px solid ${fuel <= 15 ? '#ffcdd2' : '#ffe082'}`,
                                                    borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8,
                                                    animation: fuel <= 15 ? 'pulse 1s infinite' : 'none'
                                                }}>
                                                    <span style={{ fontSize: '1.1rem' }}>{fuel <= 15 ? '🔴' : '🟡'}</span>
                                                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: fuel <= 15 ? '#e74c3c' : '#e67e22' }}>
                                                        {fuel <= 15 ? 'Critical fuel! Driver must refuel immediately.' : `Low fuel (${fuel}%) — driver should refuel soon.`}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Action Buttons (no Refuel — admin cannot refuel vehicles) */}
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                                <button
                                                    onClick={() => handleViewDriverOnMap(d._id)}
                                                    style={{ padding: '8px', background: '#3498db', color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}
                                                >
                                                    🗺 Track on Map
                                                </button>
                                                <button
                                                    onClick={() => simulateMove(d._id)}
                                                    style={{ padding: '8px', background: '#17a2b8', color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}
                                                >
                                                    📍 Simulate Move
                                                </button>
                                                {!d.isAvailable && !isBrokenDown && (
                                                    <button
                                                        onClick={() => handleVehicleBreakdown(d._id)}
                                                        style={{ padding: '8px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', gridColumn: 'span 2' }}
                                                    >
                                                        🚨 Report Breakdown
                                                    </button>
                                                )}
                                                {isBrokenDown && (
                                                    <div style={{ gridColumn: 'span 2', padding: '8px', background: '#ffebee', border: '1px solid #ffcdd2', borderRadius: 7, textAlign: 'center', color: '#e74c3c', fontWeight: 600, fontSize: '0.82rem' }}>
                                                        🔴 Vehicle Broken Down — Reassignment in progress
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* VIEW: MAP */}
                    {activeView === 'map' && (
                        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                            {/* Controls Overlay Panel */}
                            <div className="panel" style={{ position: 'absolute', top: '16px', left: '16px', width: '290px', display: 'flex', flexDirection: 'column', height: 'fit-content', zIndex: 1000, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.18)', borderRadius: '10px', background: 'white' }}>
                                <h3>Map Controls</h3>

                                {/* 1. FILTER CONTROLS */}
                                {selectedDriver ? (
                                    <div style={{ marginBottom: '20px', padding: '15px', background: '#d1ecf1', borderRadius: '5px', border: '1px solid #bee5eb' }}>
                                        <p style={{ margin: '0 0 10px 0', color: '#0c5460' }}>
                                            Tracking: <strong>{drivers.find(d => d._id === selectedDriver)?.name}</strong>
                                        </p>
                                        <button onClick={() => { setSelectedDriver(null); setMapCenter(WAREHOUSE_COORDS); }} style={{ width: '100%', backgroundColor: '#17a2b8' }}>
                                            Show All Drivers
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="form-group">
                                            <label style={mapControlLabelStyle}>Optimization Engine</label>
                                            <select value={algorithm} onChange={e => setAlgorithm(e.target.value)} style={mapControlSelectStyle}>
                                                <option value="gmaps-tsp">TSP Nearest-Neighbour (Standard)</option>
                                                <option value="aco">Ant Colony Optimisation (ACO)</option>
                                                <option value="genetic">Genetic Algorithm (Capacity Aware)</option>
                                            </select>
                                        </div>

                                        <div className="form-group" style={{ marginTop: -4 }}>
                                            <label style={mapControlLabelStyle}>Driver Route Focus</label>
                                            <select value={routeFocusDriverId} onChange={e => setRouteFocusDriverId(e.target.value)} style={mapControlSelectStyle}>
                                                {drivers.filter(d => !d.isAvailable).length === 0 && <option value="">No active routes yet</option>}
                                                {drivers.filter(d => !d.isAvailable).map(d => (
                                                    <option key={d._id} value={d._id}>{getVehicleIcon(d.vehicleType)} {d.name} ({d.vehicleType})</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div style={{ marginBottom: 12, border: '1px solid #e9ecef', borderRadius: 8, padding: 10, background: '#f8fafc' }}>
                                            <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: 8, color: '#2c3e50' }}>Delivery Status</div>
                                            <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: '0.78rem' }}>
                                                {deliveries.length === 0 ? (
                                                    <div style={{ color: '#888' }}>No deliveries available</div>
                                                ) : (
                                                    deliveries.map(d => (
                                                        <div key={d._id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed #edf2f7' }}>
                                                            <span style={{ maxWidth: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.customerName}</span>
                                                            <span className={`badge ${d.status}`}>{d.status}</span>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>

                                        <div style={{ marginBottom: 12, border: '1px solid #e9ecef', borderRadius: 8, padding: 10, background: '#f8fafc' }}>
                                            <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: 8, color: '#2c3e50' }}>Driver Status</div>
                                            <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: '0.78rem' }}>
                                                {drivers.map(d => (
                                                    <div key={d._id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed #edf2f7' }}>
                                                        <span style={{ maxWidth: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
                                                        <span style={{ color: d.isAvailable ? '#27ae60' : '#f39c12', fontWeight: 700 }}>{d.isAvailable ? 'Available' : 'On Route'}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                )}

                                {/* 2. ACTION BUTTONS */}
                                <button
                                    onClick={handleGenerateSchedule}
                                    disabled={appStatus !== 'ready'}
                                    style={{ marginBottom: '15px', padding: '12px', fontSize: '1rem', background: appStatus === 'generating' ? '#f39c12' : '#28a745' }}>
                                    {appStatus === 'generating' ? 'AI is Optimizing...' : 'Generate AI Schedule'}
                                </button>
                                <p style={{ fontSize: '0.8rem', textAlign: 'center', marginTop: -10, marginBottom: 10 }}>
                                    Active Constraints: {blockages.length}
                                    {blockages.length > 0 && <span onClick={() => setBlockages([])} style={{ color: 'red', cursor: 'pointer', marginLeft: '5px' }}>(Clear)</span>}
                                </p>

                                {/* Route Legend removed — map is self-explanatory with colored polylines */}
                                {isRoutingAdmin && (
                                    <div style={{ marginBottom: 10, padding: '6px 12px', background: '#fff3cd', borderRadius: 6, fontSize: '0.8rem', color: '#856404' }}>⏳ Computing routes...</div>
                                )}

                                {/* 3. NEW FEATURES: TRAFFIC & COMPARE */}
                                {!selectedDriver && (
                                    <div style={{ marginBottom: '15px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                                        <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: '#555' }}>Advanced AI Tools</h4>

                                        <button
                                            onClick={toggleTrafficMode}
                                            style={{ background: isTrafficMode ? '#e74c3c' : '#f39c12', marginBottom: '10px', width: '100%' }}>
                                            {isTrafficMode ? 'DONE BLOCKING 🛑' : '🚦 Simulate Traffic Jam'}
                                        </button>

                                        <button
                                            onClick={handleCompare}
                                            style={{ background: '#8e44ad', width: '100%' }}>
                                            ⚖ Compare: Standard vs AI
                                        </button>

                                        <button
                                            onClick={() => setShowRouteComparison(!showRouteComparison)}
                                            style={{ background: showRouteComparison ? '#e67e22' : '#f1c40f', width: '100%', marginTop: '10px' }}>
                                            {showRouteComparison ? '🔄 Hide Route Comparison' : '👁 Show Route Comparison'}
                                        </button>
                                    </div>
                                )}

                                {/* 4. COMPARISON WIDGET */}
                                {comparisonData && (
                                    <div style={{ marginBottom: '15px', padding: '10px', background: '#f8f9fa', border: '1px solid #ddd', fontSize: '0.85rem' }}>
                                        <h4 style={{ margin: '0 0 6px 0' }}>Analysis Result</h4>
                                        {comparisonData.driverName && <div style={{ fontSize: '0.78rem', color: '#3498db', fontWeight: 700, marginBottom: 8 }}>🚛 {comparisonData.driverName}</div>}
                                        <div style={{ color: comparisonData.algo_1?.color || '#27ae60', marginBottom: '5px' }}>
                                            <strong>{comparisonData.algo_1?.name || 'AI Optimized'}</strong><br />
                                            {comparisonData.algo_1?.duration || '?'} | {comparisonData.algo_1?.distance || '?'}
                                        </div>
                                        <div style={{ color: comparisonData.algo_2?.color || '#e74c3c' }}>
                                            <strong>{comparisonData.algo_2?.name || 'Standard'}</strong><br />
                                            {comparisonData.algo_2?.duration || '?'} | {comparisonData.algo_2?.distance || '?'}
                                        </div>
                                        <div style={{ marginTop: '8px', fontStyle: 'italic', color: '#27ae60', fontSize: '0.8rem' }}>
                                            ⏱ Time Saved: {comparisonData.algo_1?.saved || 'See Comparison view'}
                                        </div>
                                        <button onClick={() => setActiveView('comparison')} style={{ marginTop: 8, width: '100%', background: '#9b59b6', color: 'white', border: 'none', padding: '6px', borderRadius: 5, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>📊 Full Comparison View →</button>
                                    </div>
                                )}

                                {/* No legacy sample/drop buttons — use + New Delivery header button instead */}
                            </div>

                            {/* Map fills full area */}
                            <div className="map-container" style={{ position: 'absolute', inset: 0 }}>
                                <MapContainer center={mapCenter} zoom={12} style={{ height: '100%' }}>
                                    <TileLayer
                                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                    />
                                    <MapRecenter
                                        center={mapCenter}
                                        zoom={selectedDriver ? 14 : 12}
                                        bounds={comparisonData && !showRouteComparison && comparisonData.algo_1 && comparisonData.algo_1.polyline ?
                                            [...parsePolyline(comparisonData.algo_1.polyline), ...(comparisonData.algo_2.polyline ? parsePolyline(comparisonData.algo_2.polyline) : [])]
                                            : focusedRoutePolyline}
                                    />

                                    {/* CLICK HANDLER: Handles Blocks or Deliveries or New Delivery Location */}
                                    <MapClickHandler
                                        isBlockMode={isTrafficMode}
                                        isAddingDelivery={isAddingDelivery}
                                        isSettingNewDeliveryLocation={showNewDeliverySidebar}
                                        onBlockAdd={handleBlockMapClick}
                                        onDeliveryAdd={(loc) => { setNewDeliveryLocation(loc); setDeliveryModalOpen(true); }}
                                        onNewDeliveryLocationSet={(loc) => setNewDeliveryLocation(loc)}
                                    />

                                    <Marker position={WAREHOUSE_COORDS} icon={warehouseIcon}><Popup>Central Warehouse</Popup></Marker>

                                    {/* NEW: Traffic Blockages Visuals - Yellow Lines */}
                                    {blockages.map((b, idx) => (
                                        <Polyline
                                            key={`traffic-block-${idx}`}
                                            positions={[
                                                [b.lat - 0.001, b.lng - 0.001],
                                                [b.lat + 0.001, b.lng + 0.001]
                                            ]}
                                            pathOptions={{ color: '#f1c40f', weight: 8, opacity: 0.8 }}
                                        >
                                            <Popup>🚧 Traffic Block Area</Popup>
                                        </Polyline>
                                    ))}

                                    {isAddingDelivery && <Marker position={mapCenter} icon={createDeliveryIcon('pending')} opacity={0.5} />}

                                    {/* Drivers */}
                                    {filteredDrivers.map(d => {
                                        const driverPos = getDriverMapPosition(d);
                                        return (
                                            <Marker key={d._id} position={driverPos} icon={createDriverIcon(d.name, d.vehicleType)}>
                                                <Popup>
                                                    <strong>{d.name}</strong><br />
                                                    Vehicle: {d.vehicleType}<br />
                                                    Status: {d.isAvailable ? 'Waiting at Warehouse' : 'On Route'}<br />
                                                    <strong>Fuel:</strong> {typeof d.fuelLevel === 'number' ? `${d.fuelLevel}%` : 'N/A'}<br />
                                                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                                                        <button onClick={() => simulateMove(d._id)} style={{ background: '#17a2b8', color: 'white', border: 'none', padding: '6px 8px', borderRadius: '4px', cursor: 'pointer' }}>Move (simulate)</button>
                                                        {!d.isAvailable && (
                                                            <button
                                                                onClick={() => handleVehicleBreakdown(d._id)}
                                                                style={{
                                                                    background: '#e74c3c',
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    padding: '6px 8px',
                                                                    borderRadius: '4px',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >
                                                                🚨 Breakdown
                                                            </button>
                                                        )}
                                                    </div>
                                                </Popup>
                                            </Marker>
                                        );
                                    })}

                                    {/* Fuel Stations Markers */}
                                    {fuelStations.map(s => (
                                        <Marker key={s.id} position={[s.coordinates[0], s.coordinates[1]]} icon={L.divIcon({ html: `<img src=\"https://img.icons8.com/fluency/48/000000/gas-station.png\" style=\"width:28px;height:28px\"/>`, className: '' })}>
                                            <Popup>
                                                <strong>{s.name}</strong><br />
                                                Distance: {s.distance_km} km
                                            </Popup>
                                        </Marker>
                                    ))}

                                    {/* Deliveries */}
                                    {filteredDeliveries.map(d => (
                                        <Marker key={d._id} position={[d.pickupLocation.coordinates[1], d.pickupLocation.coordinates[0]]} icon={createDeliveryIcon(d.status)}>
                                            <Popup>
                                                <strong>{d.customerName}</strong> ({d.weight || 5}kg)<br />
                                                Deadline: {d.deadline || 'N/A'} mins<br />
                                                Status: {d.status}<br />
                                                <button className="popup-delete-btn" onClick={() => handleDeleteDelivery(d._id)}>Delete Order</button>
                                            </Popup>
                                        </Marker>
                                    ))}

                                    {/* Routes — ORS real road routes, per-driver colored */}
                                    {!comparisonData && !showRouteComparison && Object.entries(adminRoutePolylines)
                                        .filter(([dId]) => !!effectiveRouteDriverId && dId === effectiveRouteDriverId)
                                        .map(([dId, routeData]) => (
                                            <Polyline
                                                key={`admin-road-${dId}`}
                                                positions={routeData.polyline}
                                                pathOptions={{
                                                    color: blockages.length > 0 ? '#22c55e' : routeData.color,
                                                    weight: selectedDriver ? 6 : 4,
                                                    opacity: routeData.fallback ? 0.6 : 0.9,
                                                    dashArray: routeData.fallback ? '8,6' : null
                                                }}
                                                interactive={true}
                                            >
                                                <Popup>
                                                    <strong>{routeData.driverName}</strong><br />
                                                    {routeData.ors ? '🛣 Real road route (ORS)' : routeData.fallback ? '📏 Straight-line (ORS unavailable)' : '✅ AI-generated route'}
                                                    {blockages.length > 0 && <><br />🟢 Avoids {blockages.length} block{blockages.length > 1 ? 's' : ''}</>}
                                                </Popup>
                                            </Polyline>
                                        ))
                                    }

                                    {/* Loading spinner overlay while OSRM routes are being fetched */}
                                    {isRoutingAdmin && (
                                        <div style={{
                                            position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
                                            background: 'rgba(0,0,0,0.7)', color: 'white',
                                            padding: '6px 14px', borderRadius: 20, fontSize: '0.82rem',
                                            zIndex: 1000, pointerEvents: 'none'
                                        }}>
                                            🛣 Computing road routes...
                                        </div>
                                    )}

                                    {/* Manual Route Comparison Mode */}
                                    {showRouteComparison && !comparisonData && (
                                        <>
                                            {/* Show all routes in blue (current) */}
                                            {filteredRoutes.map(r => r.polyline && parsePolyline(r.polyline) && (
                                                <Polyline
                                                    key={`current-${r._id}`}
                                                    positions={parsePolyline(r.polyline)}
                                                    color="#0d6efd"
                                                    weight={5}
                                                    interactive={false}
                                                >
                                                    <Popup>Current Route</Popup>
                                                </Polyline>
                                            ))}
                                            {/* If we have comparison data, show optimized in green */}
                                            {comparisonData && comparisonData.algo_1.polyline && parsePolyline(comparisonData.algo_1.polyline) && (
                                                <Polyline
                                                    positions={parsePolyline(comparisonData.algo_1.polyline)}
                                                    color="#27ae60"
                                                    weight={4}
                                                    dashArray="10, 10"
                                                    interactive={false}
                                                >
                                                    <Popup>Optimized Route</Popup>
                                                </Polyline>
                                            )}
                                        </>
                                    )}



                                    {/* Routes (Comparison Mode) */}
                                    {comparisonData && !showRouteComparison && comparisonData.algo_1.polyline && parsePolyline(comparisonData.algo_1.polyline) && comparisonData.algo_2.polyline && parsePolyline(comparisonData.algo_2.polyline) && (
                                        <>
                                            <Polyline
                                                positions={parsePolyline(comparisonData.algo_1.polyline)}
                                                color={comparisonData.algo_1.color}
                                                weight={5}
                                                opacity={0.6}
                                                dashArray="10, 10"
                                                interactive={false}
                                            >
                                                <Popup>Strategy: {comparisonData.algo_1.name}</Popup>
                                            </Polyline>

                                            <Polyline
                                                positions={parsePolyline(comparisonData.algo_2.polyline)}
                                                color={comparisonData.algo_2.color}
                                                weight={6}
                                                interactive={false}
                                            >
                                                <Popup>Strategy: {comparisonData.algo_2.name}</Popup>
                                            </Polyline>
                                        </>
                                    )}

                                </MapContainer>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* NEW DELIVERY SIDEBAR */}
            {showNewDeliverySidebar && (
                <div style={{
                    position: 'fixed',
                    top: '80px',
                    right: '20px',
                    width: '350px',
                    maxHeight: 'calc(100vh - 100px)',
                    background: 'white',
                    boxShadow: '-4px 4px 20px rgba(0,0,0,0.3)',
                    zIndex: 10000,
                    padding: '20px',
                    overflowY: 'auto',
                    borderRadius: '10px',
                    border: '2px solid #28a745'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid #eee', paddingBottom: '10px' }}>
                        <div>
                            <h3 style={{ margin: 0, color: '#28a745' }}>🚚 Create New Delivery</h3>
                            <small style={{ color: '#666', fontSize: '0.8rem' }}>Data persists when closed • Click map to set location</small>
                        </div>
                        <button
                            onClick={() => setShowNewDeliverySidebar(false)}
                            title="Close (data will be saved)"
                            style={{
                                background: '#95a5a6',
                                border: 'none',
                                color: 'white',
                                width: '30px',
                                height: '30px',
                                borderRadius: '50%',
                                cursor: 'pointer',
                                fontSize: '1.2rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            ×
                        </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Customer Name *</label>
                            <input
                                type="text"
                                value={newDeliveryData.customerName}
                                onChange={(e) => setNewDeliveryData({ ...newDeliveryData, customerName: e.target.value })}
                                placeholder="Enter customer name"
                                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Phone Number</label>
                            <input
                                type="text"
                                value={newDeliveryData.customerPhone}
                                onChange={(e) => setNewDeliveryData({ ...newDeliveryData, customerPhone: e.target.value })}
                                placeholder="Enter phone number"
                                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Full Address <span style={{ fontWeight: 400, color: '#888', fontSize: '0.78rem' }}>(type to geocode — or click map)</span></label>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <input
                                    type="text"
                                    value={newDeliveryData.fullAddress}
                                    onChange={(e) => { setNewDeliveryData({ ...newDeliveryData, fullAddress: e.target.value }); setGeocodeStatus(''); }}
                                    placeholder="E.g. Anna Nagar, Chennai"
                                    style={{ flex: 1, padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                                />
                                <button
                                    onClick={handleGeocodeNewDelivery}
                                    disabled={isGeocoding}
                                    title="Geocode address via ORS"
                                    style={{ padding: '8px 10px', background: '#17a2b8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, whiteSpace: 'nowrap' }}
                                >
                                    {isGeocoding ? '⏳' : '📍 Find'}
                                </button>
                            </div>
                            {geocodeStatus && (
                                <div style={{ marginTop: 4, fontSize: '0.78rem', color: geocodeStatus.includes('✅') ? '#27ae60' : '#e74c3c' }}>
                                    {geocodeStatus}
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Area Type</label>
                                <select
                                    value={newDeliveryData.area}
                                    onChange={(e) => setNewDeliveryData({ ...newDeliveryData, area: e.target.value })}
                                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                                >
                                    <option value="urban">Urban</option>
                                    <option value="suburban">Suburban</option>
                                    <option value="rural">Rural</option>
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Zone</label>
                                <input
                                    type="text"
                                    value={newDeliveryData.zone}
                                    onChange={(e) => setNewDeliveryData({ ...newDeliveryData, zone: e.target.value })}
                                    placeholder="Zone (optional)"
                                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Weight (kg)</label>
                                <input
                                    type="number"
                                    value={newDeliveryData.weight}
                                    onChange={(e) => setNewDeliveryData({ ...newDeliveryData, weight: Number(e.target.value) })}
                                    min="0.1"
                                    step="0.1"
                                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Package Size</label>
                                <select
                                    value={newDeliveryData.size}
                                    onChange={(e) => setNewDeliveryData({ ...newDeliveryData, size: e.target.value })}
                                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                                >
                                    <option value="small">Small (Bike)</option>
                                    <option value="medium">Medium (Truck)</option>
                                    <option value="large">Large (Heavy Truck)</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Deadline (minutes)</label>
                            <input
                                type="number"
                                value={newDeliveryData.deadline}
                                onChange={(e) => setNewDeliveryData({ ...newDeliveryData, deadline: Number(e.target.value) })}
                                min="30"
                                style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                    type="checkbox"
                                    checked={newDeliveryData.emergency}
                                    onChange={(e) => setNewDeliveryData({ ...newDeliveryData, emergency: e.target.checked })}
                                />
                                <span style={{ fontWeight: 'bold', color: '#e74c3c' }}>🚨 Emergency Delivery</span>
                            </label>
                        </div>

                        <div style={{ border: '1px solid #ddd', padding: '10px', borderRadius: '4px', background: '#f9f9f9' }}>
                            <strong>Location:</strong>
                            {newDeliveryLocation ? (
                                <div>
                                    Lat: {newDeliveryLocation.lat.toFixed(4)}, Lng: {newDeliveryLocation.lng.toFixed(4)}
                                    <br />
                                    <button
                                        onClick={() => setNewDeliveryLocation(null)}
                                        style={{ marginTop: '5px', padding: '5px 10px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                                    >
                                        Clear Location
                                    </button>
                                </div>
                            ) : (
                                <span style={{ color: '#e74c3c' }}>Click on map to set delivery location</span>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                            <button
                                onClick={() => {
                                    setNewDeliveryData({
                                        customerName: '',
                                        customerPhone: '',
                                        fullAddress: '',
                                        area: 'urban',
                                        zone: 'Unzoned',
                                        weight: 5,
                                        size: 'medium',
                                        deadline: 480,
                                        emergency: false
                                    });
                                    setNewDeliveryLocation(null);
                                    setShowNewDeliverySidebar(false);
                                }}
                                style={{
                                    padding: '10px 15px',
                                    background: '#6c757d',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    flex: 1
                                }}
                            >
                                ❌ Cancel & Clear
                            </button>

                            <button
                                onClick={handleCreateAndAllocateDelivery}
                                disabled={!newDeliveryData.customerName || !newDeliveryLocation}
                                style={{
                                    padding: '10px 15px',
                                    background: (!newDeliveryData.customerName || !newDeliveryLocation) ? '#ccc' : '#28a745',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: (!newDeliveryData.customerName || !newDeliveryLocation) ? 'not-allowed' : 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: 'bold',
                                    flex: 2
                                }}
                            >
                                🚚 Create & Auto-Allocate
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Removed overlay - map stays visible while filling delivery details */}

        </div>
    );
}

export default AdminDashboard;
