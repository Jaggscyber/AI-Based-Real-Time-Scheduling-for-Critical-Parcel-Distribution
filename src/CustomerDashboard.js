import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import './App.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
    iconUrl: require('leaflet/dist/images/marker-icon.png'),
    shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const BACKEND_URL = "http://localhost:5000";
const socket = io(BACKEND_URL, { transports: ['websocket'] });

const driverIcon = new L.Icon({ iconUrl: 'https://img.icons8.com/plasticine/100/000000/truck.png', iconSize: [52, 52], iconAnchor: [26, 26] });
const homeIcon = new L.Icon({ iconUrl: 'https://img.icons8.com/plasticine/100/000000/home.png', iconSize: [42, 42], iconAnchor: [21, 42] });

// Real ORS road route via backend proxy (POST /api/routes/directions)
const fetchOrsRoute = async (from, to) => {
    try {
        const res = await axios.post(`${BACKEND_URL}/api/routes/directions`, {
            waypoints: [from, to]
        }, { timeout: 10000 });
        if (res.data && res.data.polyline && res.data.polyline.length > 1) {
            return {
                polyline: res.data.polyline,
                durationMin: parseFloat(res.data.totalDuration) || 0
            };
        }
    } catch (e) {
        console.warn('[Customer ORS]', e.message);
    }
    // Haversine fallback so UI never breaks
    const R = 6371;
    const dLat = (to[0] - from[0]) * Math.PI / 180;
    const dLng = (to[1] - from[1]) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(from[0] * Math.PI / 180) * Math.cos(to[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return { polyline: [from, to], durationMin: distKm / 0.4 };
};

// Status timeline config
const STATUS_STEPS = [
    { key: 'pending', label: 'Order Placed', icon: '📦' },
    { key: 'assigned', label: 'At Warehouse', icon: '🏭' },
    { key: 'in_transit', label: 'Out for Delivery', icon: '🚚' },
    { key: 'delivered', label: 'Delivered', icon: '✅' },
];
const STATUS_ORDER = ['pending', 'assigned', 'in_transit', 'delivered'];

const CustomerDashboard = () => {
    const [packageId, setPackageId] = useState('');
    const [activePackage, setActivePackage] = useState(null);
    const [viewMode, setViewMode] = useState('track'); // 'track' | 'order'
    const [isOrdering, setIsOrdering] = useState(false);
    const [orderData, setOrderData] = useState({ customerName: '', customerPhone: '', fullAddress: '', itemsText: '' });
    const [orderLocation, setOrderLocation] = useState(null);
    const [geocodeStatus, setGeocodeStatus] = useState('');
    const [isTracking, setIsTracking] = useState(false);
    const [error, setError] = useState('');
    const [liveOTP, setLiveOTP] = useState(null);
    const [routePolyline, setRoutePolyline] = useState(null);
    const [eta, setEta] = useState(null);
    const [notification, setNotification] = useState(null);
    const [otpLoading, setOtpLoading] = useState(false);
    const etaIntervalRef = useRef(null);

    // ── Live re-fetch on socket events ───────────────────────────────────────
    const refreshTracking = useCallback(async (pkgId) => {
        const id = pkgId || (activePackage && (activePackage.id || activePackage._id));
        if (!id) return;
        try {
            const res = await axios.get(`${BACKEND_URL}/api/deliveries/track/${id}`);
            setActivePackage(res.data);
        } catch (_) { }
    }, [activePackage]);

    useEffect(() => {
        const onDriverLocation = () => refreshTracking();
        const onScheduleUpdate = () => refreshTracking();
        socket.on('driverLocationUpdated', onDriverLocation);
        socket.on('scheduleUpdated', onScheduleUpdate);
        return () => {
            socket.off('driverLocationUpdated', onDriverLocation);
            socket.off('scheduleUpdated', onScheduleUpdate);
        };
    }, [refreshTracking]);

    // ── Compute ORS road route when driver location changes ─────────────────
    useEffect(() => {
        if (!activePackage) { setRoutePolyline(null); setEta(null); return; }
        if (activePackage.status === 'delivered') { setRoutePolyline(null); return; }

        const drvLoc = activePackage.driverLocation;
        const destLoc = activePackage.pickupLocation;
        if (!drvLoc?.coordinates || !destLoc?.coordinates) return;

        const fromLL = [drvLoc.coordinates[1], drvLoc.coordinates[0]];
        const toLL = [destLoc.coordinates[1], destLoc.coordinates[0]];

        (async () => {
            const result = await fetchOrsRoute(fromLL, toLL);
            if (result) {
                setRoutePolyline(result.polyline);
                setEta(Math.round(result.durationMin));
            }
        })();
    }, [activePackage?.driverLocation, activePackage?.pickupLocation]);

    // ── Auto-generate OTP when in_transit ────────────────────────────────────
    useEffect(() => {
        if (!activePackage) return;
        const id = activePackage.id || activePackage._id;
        if (activePackage.status === 'in_transit' && !liveOTP && !otpLoading) {
            // If OTP already on package data, use it
            if (activePackage.otp) {
                setLiveOTP(activePackage.otp);
                return;
            }
            setOtpLoading(true);
            axios.post(`${BACKEND_URL}/api/deliveries/${id}/generate-otp`)
                .then(res => setLiveOTP(res.data.otp))
                .catch(() => { })
                .finally(() => setOtpLoading(false));
        }
        if (activePackage.status !== 'in_transit') {
            setLiveOTP(null);
        }
    }, [activePackage?.status]);

    // ── ETA countdown refresh every 30 seconds ────────────────────────────────
    useEffect(() => {
        if (etaIntervalRef.current) clearInterval(etaIntervalRef.current);
        if (activePackage && activePackage.status !== 'delivered') {
            etaIntervalRef.current = setInterval(() => refreshTracking(), 30000);
        }
        return () => clearInterval(etaIntervalRef.current);
    }, [activePackage?._id, activePackage?.status]);

    // ── Search / track ────────────────────────────────────────────────────────
    const handleSearch = async (e) => {
        e.preventDefault();
        setIsTracking(true);
        setError('');
        setActivePackage(null);
        setRoutePolyline(null);
        setLiveOTP(null);
        setEta(null);
        try {
            const res = await axios.get(`${BACKEND_URL}/api/deliveries/track/${packageId.trim()}`);
            setActivePackage(res.data);
        } catch (err) {
            setError(err.response?.data?.msg || 'Tracking ID not found. Check the ID and try again.');
        } finally {
            setIsTracking(false);
        }
    };

    // ── Ordering helpers ──────────────────────────────────────────────────────
    const handleGeocodeAddress = async () => {
        if (!orderData.fullAddress || orderData.fullAddress.trim().length < 3) { setGeocodeStatus('Enter a valid address'); return; }
        setGeocodeStatus('Searching...');
        try {
            const res = await axios.get(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(orderData.fullAddress)}`);
            if (res.data?.length > 0) {
                setOrderLocation({ lat: parseFloat(res.data[0].lat), lng: parseFloat(res.data[0].lon) });
                setGeocodeStatus('✅ Location set');
            } else { setGeocodeStatus('No results found'); }
        } catch { setGeocodeStatus('Geocoding failed'); }
    };

    const handlePlaceOrder = async () => {
        if (!orderData.customerName || !orderData.customerPhone || !orderLocation) { setGeocodeStatus('Provide name, phone and location'); return; }
        setIsOrdering(true);
        try {
            const items = orderData.itemsText ? orderData.itemsText.split('\n').map(s => s.trim()).filter(Boolean) : ['Package'];
            const res = await axios.post(`${BACKEND_URL}/api/deliveries`, {
                pickupLocation: { type: 'Point', coordinates: [orderLocation.lng, orderLocation.lat] },
                customerName: orderData.customerName, customerPhone: orderData.customerPhone,
                fullAddress: orderData.fullAddress, items, weight: 5, area: 'urban', size: 'small', deadline: 480, emergency: false
            });
            setPackageId(res.data._id);
            const trackRes = await axios.get(`${BACKEND_URL}/api/deliveries/track/${res.data._id}`);
            setActivePackage(trackRes.data);
            setViewMode('track');
            setGeocodeStatus('Order placed!');
            setNotification('📦 Order placed! Your package is now at the warehouse.');
        } catch (err) {
            setGeocodeStatus(err.response?.data?.msg || 'Failed to place order');
        } finally { setIsOrdering(false); }
    };

    // ── Timeline helpers ──────────────────────────────────────────────────────
    const getStatusTimestamp = (pkg, status) => {
        if (!pkg?.statusHistory?.length) return null;
        const entry = [...pkg.statusHistory].reverse().find(h => h.status === status);
        return entry ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
    };

    const currentStepIndex = activePackage ? STATUS_ORDER.indexOf(activePackage.status) : -1;

    // ── Smart notification for proximity ─────────────────────────────────────
    useEffect(() => {
        if (!eta) return;
        if (eta <= 15) setNotification(`🚚 Driver is almost there — arriving in ~${eta} min!`);
        else if (eta <= 30) setNotification(`📍 Driver is nearby — estimated ${eta} min away.`);
    }, [eta]);

    // ── Map center from driver or warehouse ───────────────────────────────────
    const mapCenter = activePackage?.driverLocation?.coordinates
        ? [activePackage.driverLocation.coordinates[1], activePackage.driverLocation.coordinates[0]]
        : (activePackage?.pickupLocation?.coordinates
            ? [activePackage.pickupLocation.coordinates[1], activePackage.pickupLocation.coordinates[0]]
            : [13.0827, 80.2707]);

    // ── Color palette ────────────────────────────────────────────────────────
    const accent = '#3b82f6';
    const accentLight = 'rgba(59, 130, 246, 0.08)';

    return (
        <div style={{ background: '#f8fafc', minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
            {/* HEADER */}
            <header style={{ background: '#ffffff', padding: '16px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontSize: '1.8rem' }}>📦</div>
                    <div>
                        <h1 style={{ margin: 0, color: '#0f172a', fontSize: '1.3rem', fontWeight: 700 }}>ParcelTrack</h1>
                        <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.78rem' }}>GA+ACO Powered Delivery</p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    {['track', 'order'].map(v => (
                        <button key={v} onClick={() => { setViewMode(v); if (v === 'track') setActivePackage(null); }}
                            style={{ padding: '8px 18px', borderRadius: 20, border: viewMode === v ? 'none' : '1px solid #e2e8f0', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', background: viewMode === v ? accent : '#ffffff', color: viewMode === v ? 'white' : '#334155', transition: 'all 0.2s', boxShadow: viewMode === v ? '0 2px 8px rgba(59,130,246,0.3)' : 'none' }}>
                            {v === 'track' ? '🔍 Track' : '➕ Order'}
                        </button>
                    ))}
                </div>
            </header>

            {/* NOTIFICATION BANNER */}
            {notification && (
                <div style={{ background: accent, color: 'white', padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', fontWeight: 600 }}>
                    <span>{notification}</span>
                    <button onClick={() => setNotification(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.1rem' }}>×</button>
                </div>
            )}

            <div style={{ flex: 1, padding: '28px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

                {/* ─── SEARCH / ORDER FORM (no activePackage) ─── */}
                {!activePackage && (
                    <div style={{ width: '100%', maxWidth: 560, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 20, padding: 32, marginTop: 20, boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }}>
                        {viewMode === 'track' && (
                            <>
                                <h2 style={{ color: '#0f172a', margin: '0 0 6px 0', fontSize: '1.6rem' }}>Where's my order?</h2>
                                <p style={{ color: '#94a3b8', margin: '0 0 24px 0', fontSize: '0.9rem' }}>Enter your Tracking ID or Phone Number to get live updates.</p>
                                <form onSubmit={handleSearch}>
                                    <input type="text" placeholder="Paste Tracking ID or Phone Number"
                                        value={packageId} onChange={e => setPackageId(e.target.value)}
                                        style={{ width: '100%', padding: '14px 16px', borderRadius: 12, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: '1rem', boxSizing: 'border-box', marginBottom: 14, outline: 'none' }}
                                        required />
                                    <button type="submit" disabled={isTracking}
                                        style={{ width: '100%', padding: '14px', background: accent, color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: '1rem', boxShadow: '0 2px 8px rgba(59,130,246,0.3)' }}>
                                        {isTracking ? '⏳ Locating...' : '🔍 Track Package'}
                                    </button>
                                </form>
                                {error && <p style={{ color: '#ef4444', marginTop: 14, fontSize: '0.9rem' }}>{error}</p>}
                            </>
                        )}

                        {viewMode === 'order' && (
                            <>
                                <h2 style={{ color: '#0f172a', margin: '0 0 18px 0', fontSize: '1.4rem' }}>Place New Order</h2>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                                    {[
                                        { ph: 'Your Name', key: 'customerName' },
                                        { ph: 'Phone Number', key: 'customerPhone' }
                                    ].map(({ ph, key }) => (
                                        <input key={key} placeholder={ph} value={orderData[key]} onChange={e => setOrderData({ ...orderData, [key]: e.target.value })}
                                            style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: '0.9rem', outline: 'none' }} />
                                    ))}
                                </div>
                                <input placeholder="Full Address" value={orderData.fullAddress} onChange={e => setOrderData({ ...orderData, fullAddress: e.target.value })}
                                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: '0.9rem', boxSizing: 'border-box', marginBottom: 10, outline: 'none' }} />
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
                                    <textarea placeholder="Items (one per line)" value={orderData.itemsText} onChange={e => setOrderData({ ...orderData, itemsText: e.target.value })}
                                        style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontSize: '0.9rem', minHeight: 70, resize: 'vertical', outline: 'none' }} />
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <button onClick={handleGeocodeAddress}
                                            style={{ padding: '10px 8px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                                            📍 Geocode
                                        </button>
                                        <button onClick={handlePlaceOrder} disabled={isOrdering}
                                            style={{ padding: '10px 8px', background: '#22c55e', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                                            {isOrdering ? 'Placing...' : '✅ Place'}
                                        </button>
                                    </div>
                                </div>
                                {geocodeStatus && (
                                    <div style={{ padding: '8px 12px', borderRadius: 8, background: geocodeStatus.includes('✅') ? '#f0fdf4' : '#fef2f2', color: geocodeStatus.includes('✅') ? '#16a34a' : '#dc2626', fontSize: '0.85rem', marginBottom: 10, border: `1px solid ${geocodeStatus.includes('✅') ? '#bbf7d0' : '#fecaca'}` }}>
                                        {geocodeStatus}
                                    </div>
                                )}
                                <div style={{ height: 200, border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
                                    <MapContainer center={orderLocation ? [orderLocation.lat, orderLocation.lng] : [13.0827, 80.2707]} zoom={13} style={{ height: '100%', width: '100%' }}>
                                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
                                        {orderLocation && <Marker position={[orderLocation.lat, orderLocation.lng]} icon={homeIcon}><Popup>Delivery Location</Popup></Marker>}
                                    </MapContainer>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* ─── ACTIVE PACKAGE TRACKED ─── */}
                {activePackage && (
                    <div style={{ width: '100%', maxWidth: 1150, display: 'flex', gap: 20, height: 'calc(100vh - 180px)', minHeight: 540, flexWrap: 'wrap' }}>

                        {/* LEFT PANEL */}
                        <div style={{ flex: '0 0 320px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
                            <button onClick={() => { setActivePackage(null); setRoutePolyline(null); setLiveOTP(null); }}
                                style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#64748b', padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontSize: '0.85rem', alignSelf: 'flex-start', transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                                ← Search Another
                            </button>

                            {/* STATUS CARD */}
                            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                    <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1rem' }}>{activePackage.customerName}</h3>
                                    <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700, background: activePackage.status === 'delivered' ? '#22c55e' : accent, color: 'white' }}>
                                        {activePackage.status?.toUpperCase().replace('_', ' ')}
                                    </span>
                                </div>
                                <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.78rem' }}>ID: {String(activePackage.id || activePackage._id).slice(-10)}</p>
                            </div>

                            {/* ETA CARD */}
                            {eta !== null && activePackage.status !== 'delivered' && (
                                <div style={{ background: accentLight, border: `1px solid rgba(59,130,246,0.15)`, borderRadius: 16, padding: 18, textAlign: 'center' }}>
                                    <div style={{ fontSize: '2.4rem', fontWeight: 800, color: accent }}>{eta}</div>
                                    <div style={{ color: '#64748b', fontSize: '0.85rem' }}>minutes away</div>
                                    <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: 4 }}>via road route • updates every 30s</div>
                                </div>
                            )}

                            {/* OTP CARD */}
                            {liveOTP && activePackage.status === 'in_transit' && (
                                <div style={{ background: '#f0fdf4', border: '2px solid #86efac', borderRadius: 16, padding: 20, textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>Give this code to your driver</div>
                                    <div style={{ fontSize: '3rem', fontWeight: 900, letterSpacing: 12, color: '#16a34a', fontFamily: 'monospace' }}>{liveOTP}</div>
                                    <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: 6 }}>🔒 OTP required to confirm delivery</div>
                                </div>
                            )}

                            {/* DRIVER CARD */}
                            {activePackage.driverName && (
                                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', fontWeight: 700, color: 'white' }}>
                                        {activePackage.driverName.charAt(0)}
                                    </div>
                                    <div>
                                        <div style={{ color: '#0f172a', fontWeight: 600, fontSize: '0.95rem' }}>{activePackage.driverName}</div>
                                        <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>🚚 Your delivery driver</div>
                                    </div>
                                </div>
                            )}

                            {/* DELIVERY STATUS TIMELINE */}
                            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                                <h4 style={{ margin: '0 0 16px 0', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: 1.5 }}>Delivery Timeline</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                                    {STATUS_STEPS.map((step, i) => {
                                        const done = i <= currentStepIndex;
                                        const active = i === currentStepIndex;
                                        const ts = getStatusTimestamp(activePackage, step.key);
                                        return (
                                            <div key={step.key} style={{ display: 'flex', gap: 14, position: 'relative' }}>
                                                {/* connector line */}
                                                {i < STATUS_STEPS.length - 1 && (
                                                    <div style={{ position: 'absolute', left: 17, top: 34, width: 2, height: 'calc(100% - 10px)', background: done && i < currentStepIndex ? accent : '#e2e8f0' }} />
                                                )}
                                                <div style={{ zIndex: 1, width: 36, height: 36, borderRadius: '50%', border: `2px solid ${done ? accent : '#e2e8f0'}`, background: active ? accent : done ? accentLight : '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0, boxShadow: active ? '0 0 12px rgba(59,130,246,0.3)' : 'none', transition: 'all 0.3s' }}>
                                                    {step.icon}
                                                </div>
                                                <div style={{ paddingBottom: i < STATUS_STEPS.length - 1 ? 22 : 0, paddingTop: 6 }}>
                                                    <div style={{ color: done ? '#0f172a' : '#94a3b8', fontWeight: active ? 700 : 500, fontSize: '0.88rem' }}>{step.label}</div>
                                                    {ts && <div style={{ color: '#94a3b8', fontSize: '0.74rem', marginTop: 2 }}>{ts}</div>}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* ITEMS */}
                            {activePackage.items?.length > 0 && (
                                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                                    <h4 style={{ margin: '0 0 10px 0', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 1.5 }}>Items</h4>
                                    <ul style={{ margin: 0, padding: '0 0 0 18px' }}>
                                        {activePackage.items.map((item, i) => (
                                            <li key={i} style={{ color: '#334155', fontSize: '0.88rem', marginBottom: 4 }}>{item}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        {/* MAP PANEL — ORS road route */}
                        <div style={{ flex: 1, minWidth: 300, borderRadius: 18, overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(0,0,0,0.06)', position: 'relative' }}>
                            {/* Map overlay label */}
                            {routePolyline && routePolyline.length > 2 && (
                                <div style={{
                                    position: 'absolute', top: 14, left: 14, zIndex: 1000,
                                    background: accent, color: 'white', borderRadius: 20,
                                    padding: '6px 14px', fontSize: '0.8rem', fontWeight: 700,
                                    boxShadow: '0 2px 8px rgba(59,130,246,0.3)'
                                }}>
                                    🛣️ Road Route • {eta ? `~${eta} min` : 'Calculating...'}
                                </div>
                            )}
                            <MapContainer center={mapCenter} zoom={14} style={{ height: '100%', width: '100%' }}>
                                <TileLayer
                                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                />

                                {/* Driver marker */}
                                {activePackage.driverLocation?.coordinates && (
                                    <Marker position={[activePackage.driverLocation.coordinates[1], activePackage.driverLocation.coordinates[0]]} icon={driverIcon}>
                                        <Popup><strong>🚚 {activePackage.driverName || 'Driver'}</strong><br />{eta ? `~${eta} min away` : 'En route'}</Popup>
                                    </Marker>
                                )}

                                {/* Delivery destination marker */}
                                {activePackage.pickupLocation?.coordinates && (
                                    <Marker position={[activePackage.pickupLocation.coordinates[1], activePackage.pickupLocation.coordinates[0]]} icon={homeIcon}>
                                        <Popup><strong>📦 Delivery Location</strong><br />{activePackage.customerName}</Popup>
                                    </Marker>
                                )}

                                {/* ORS real road route polyline */}
                                {routePolyline && routePolyline.length > 1 && (
                                    <Polyline
                                        positions={routePolyline}
                                        pathOptions={{
                                            color: accent,
                                            weight: routePolyline.length > 2 ? 5 : 3,
                                            opacity: 0.85,
                                            dashArray: routePolyline.length <= 2 ? '8,6' : null
                                        }}
                                    />
                                )}
                            </MapContainer>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CustomerDashboard;