import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

const BACKEND_URL = 'http://localhost:5000';
const WAREHOUSE = [13.0827, 80.2707];

// Fix leaflet default icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'), iconUrl: require('leaflet/dist/images/marker-icon.png'), shadowUrl: require('leaflet/dist/images/marker-shadow.png') });

const warehouseIcon = L.divIcon({
    html: `<div style="background:#6366f1;border:3px solid white;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;box-shadow:0 2px 10px rgba(0,0,0,0.3)">🏭</div>`,
    className: '', iconSize: [34, 34], iconAnchor: [17, 17]
});

const deliveryIcon = (status) => {
    const colors = { pending: '#f59e0b', assigned: '#3b82f6', in_transit: '#8b5cf6', delivered: '#10b981', failed: '#ef4444' };
    const color = colors[status] || '#64748b';
    const emoji = { pending: '📦', assigned: '🚚', in_transit: '🛵', delivered: '✅', failed: '❌' }[status] || '📦';
    return L.divIcon({ html: `<div style="background:${color};border:3px solid white;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:0.85rem;box-shadow:0 2px 8px rgba(0,0,0,0.3)">${emoji}</div>`, className: '', iconSize: [30, 30], iconAnchor: [15, 15] });
};

function MapFit({ positions }) {
    const map = useMap();
    useEffect(() => {
        if (positions && positions.length > 1) {
            try { map.fitBounds(L.latLngBounds(positions), { padding: [40, 40] }); } catch (e) {}
        }
    }, [positions, map]);
    return null;
}

const STATUS_CONFIG = {
    pending:    { label: 'Pending',    bg: '#fef3c7', color: '#92400e', border: '#fde68a', emoji: '⏳' },
    assigned:   { label: 'Assigned',   bg: '#dbeafe', color: '#1e40af', border: '#bfdbfe', emoji: '🚚' },
    in_transit: { label: 'In Transit', bg: '#ede9fe', color: '#5b21b6', border: '#ddd6fe', emoji: '🛵' },
    delivered:  { label: 'Delivered',  bg: '#d1fae5', color: '#065f46', border: '#a7f3d0', emoji: '✅' },
    failed:     { label: 'Failed',     bg: '#fee2e2', color: '#991b1b', border: '#fecaca', emoji: '❌' },
};

export default function CustomerPortal() {
    const navigate = useNavigate();
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const token = localStorage.getItem('token');

    const [tab, setTab] = useState('orders'); // 'orders' | 'track'
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [routePolyline, setRoutePolyline] = useState([]);
    const [routeLoading, setRouteLoading] = useState(false);
    const [phoneSearch, setPhoneSearch] = useState(user.phone || '');
    const [otpInput, setOtpInput] = useState('');
    const [otpMsg, setOtpMsg] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    // ── Live driver location polling state
    const [liveDriverLoc, setLiveDriverLoc] = useState(null); // [lat, lng]
    const [etaSeconds, setEtaSeconds]       = useState(null); // countdown seconds
    const pollingRef = React.useRef(null);
    const etaTimerRef = React.useRef(null);

    // Redirect if not logged in
    useEffect(() => {
        if (!token || !user.id) navigate('/customer-login');
    }, [token, user.id, navigate]);

    const fetchOrders = useCallback(async (phone) => {
        if (!phone?.trim()) return;
        setLoading(true); setError('');
        try {
            const res = await axios.get(`${BACKEND_URL}/api/deliveries/my-orders?phone=${encodeURIComponent(phone.trim())}`);
            setOrders(res.data || []);
        } catch (err) {
            setError('Could not fetch your orders. Please check your phone number.');
        } finally { setLoading(false); }
    }, []);

    useEffect(() => {
        if (user.phone) fetchOrders(user.phone);
    }, [user.phone, fetchOrders]);

    const handleRefresh = async () => {
        setRefreshing(true);
        await fetchOrders(phoneSearch);
        setRefreshing(false);
    };

    // ── Live driver location polling ──────────────────────────────────────────────────
    // When an in_transit order is selected, poll for the driver's current position every 10s
    useEffect(() => {
        const startPolling = async () => {
            if (!selectedOrder || selectedOrder.status !== 'in_transit' || !selectedOrder.assignedDriver) {
                setLiveDriverLoc(null);
                return;
            }
            // Initial fetch
            try {
                const res = await axios.get(`${BACKEND_URL}/api/drivers/locations`);
                const driverEntry = (res.data || []).find(d => String(d._id) === String(selectedOrder.assignedDriver));
                if (driverEntry) {
                    setLiveDriverLoc([driverEntry.lat, driverEntry.lng]);
                    // Rough ETA: haversine distance ÷ avg 30 km/h
                    if (selectedOrder.pickupLocation?.coordinates) {
                        const [dLng, dLat] = selectedOrder.pickupLocation.coordinates;
                        const R = 6371;
                        const dLatR = (dLat - driverEntry.lat) * Math.PI / 180;
                        const dLngR = (dLng - driverEntry.lng) * Math.PI / 180;
                        const a = Math.sin(dLatR / 2) ** 2 + Math.cos(driverEntry.lat * Math.PI / 180) * Math.cos(dLat * Math.PI / 180) * Math.sin(dLngR / 2) ** 2;
                        const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                        setEtaSeconds(Math.round((distKm / 30) * 3600)); // seconds
                    }
                }
            } catch (e) { /* silent */ }
        };
        startPolling();
        pollingRef.current = setInterval(startPolling, 10000);
        return () => clearInterval(pollingRef.current);
    }, [selectedOrder]);

    // ETA countdown timer
    useEffect(() => {
        clearInterval(etaTimerRef.current);
        if (etaSeconds !== null && etaSeconds > 0) {
            etaTimerRef.current = setInterval(() => {
                setEtaSeconds(s => (s !== null && s > 0) ? s - 1 : 0);
            }, 1000);
        }
        return () => clearInterval(etaTimerRef.current);
    }, [etaSeconds]);

    const etaDisplay = etaSeconds !== null
        ? etaSeconds <= 0
            ? 'Arriving now'
            : etaSeconds < 60
                ? `${etaSeconds}s`
                : `${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s`
        : null;

    // Fetch ORS road route for selected order
    const fetchRoute = useCallback(async (order) => {
        setSelectedOrder(order);
        setRoutePolyline([]);
        setOtpInput(''); setOtpMsg('');
        if (!order.pickupLocation?.coordinates) return;
        setRouteLoading(true);
        const destLat = order.pickupLocation.coordinates[1];
        const destLng = order.pickupLocation.coordinates[0];
        const waypoints = [WAREHOUSE, [destLat, destLng]];
        try {
            const res = await axios.post(`${BACKEND_URL}/api/routes/directions`, { waypoints });
            if (res.data.polyline && res.data.polyline.length > 2) {
                setRoutePolyline(res.data.polyline);
            } else {
                setRoutePolyline(waypoints);
            }
        } catch {
            setRoutePolyline(waypoints);
        } finally { setRouteLoading(false); }
    }, []);

    const handleVerifyOtp = async () => {
        if (!selectedOrder || !otpInput.trim()) return;
        try {
            const res = await axios.post(`${BACKEND_URL}/api/deliveries/${selectedOrder.id}/verify-otp`, { otp: otpInput.trim() });
            setOtpMsg(res.data.message || '✅ OTP Verified! Delivery confirmed.');
            fetchOrders(phoneSearch);
        } catch (err) {
            setOtpMsg('❌ ' + (err.response?.data?.message || 'Invalid OTP.'));
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/customer-login');
    };

    const statusCfg = (s) => STATUS_CONFIG[s] || { label: s, bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', emoji: '📦' };

    return (
        <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: "'Inter','Segoe UI',sans-serif", color: 'white' }}>
            {/* ── HEADER ── */}
            <header style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '0 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: '1.6rem' }}>📦</span>
                    <span style={{ fontWeight: 800, fontSize: '1.2rem', color: 'white', letterSpacing: -0.3 }}>ParcelTrack</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'white' }}>{user.name || 'Customer'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)' }}>{user.email}</div>
                    </div>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1rem' }}>
                        {(user.name || 'U')[0].toUpperCase()}
                    </div>
                    <button onClick={handleLogout} style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', padding: '7px 16px', borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem' }}>
                        Sign Out
                    </button>
                </div>
            </header>

            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
                {/* ── WELCOME ── */}
                <div style={{ marginBottom: 28 }}>
                    <h2 style={{ margin: 0, fontWeight: 800, fontSize: '1.7rem', color: 'white' }}>
                        Welcome back, {user.name?.split(' ')[0] || 'Customer'} 👋
                    </h2>
                    <p style={{ margin: '6px 0 0', color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem' }}>Track your deliveries and manage your orders in real-time.</p>
                </div>

                {/* ── PHONE SEARCH BAR (if no phone on file) ── */}
                {!user.phone && (
                    <div style={{ display: 'flex', gap: 12, marginBottom: 24, maxWidth: 480 }}>
                        <input
                            value={phoneSearch} onChange={e => setPhoneSearch(e.target.value)}
                            placeholder="Enter your registered phone number"
                            style={{ flex: 1, padding: '11px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', color: 'white', fontSize: '0.95rem', outline: 'none' }}
                        />
                        <button onClick={() => fetchOrders(phoneSearch)}
                            style={{ padding: '11px 20px', background: '#6366f1', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontWeight: 700 }}>
                            Search
                        </button>
                    </div>
                )}

                {/* ── STATS STRIP ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 28 }}>
                    {[
                        { label: 'Total Orders', val: orders.length, color: '#6366f1', emoji: '📦' },
                        { label: 'In Transit', val: orders.filter(o => o.status === 'in_transit').length, color: '#8b5cf6', emoji: '🛵' },
                        { label: 'Delivered', val: orders.filter(o => o.status === 'delivered').length, color: '#10b981', emoji: '✅' },
                        { label: 'Pending', val: orders.filter(o => o.status === 'pending').length, color: '#f59e0b', emoji: '⏳' },
                    ].map(s => (
                        <div key={s.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
                            <div style={{ width: 44, height: 44, borderRadius: 12, background: `${s.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', flexShrink: 0 }}>{s.emoji}</div>
                            <div>
                                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.val}</div>
                                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>{s.label}</div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* ── TAB SWITCHER ── */}
                <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 4, width: 'fit-content', marginBottom: 24 }}>
                    {[['orders', '📋 My Orders'], ['track', '🗺️ Track Package']].map(([val, label]) => (
                        <button key={val} onClick={() => setTab(val)}
                            style={{ padding: '9px 22px', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem', transition: 'all 0.2s', background: tab === val ? '#6366f1' : 'transparent', color: tab === val ? 'white' : 'rgba(255,255,255,0.5)', boxShadow: tab === val ? '0 2px 10px rgba(99,102,241,0.35)' : 'none' }}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* ─────────────────────────────── MY ORDERS TAB ─────────────────────────────── */}
                {tab === 'orders' && (
                    <div>
                        {/* Refresh */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                            <button onClick={handleRefresh} disabled={refreshing}
                                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', padding: '7px 16px', borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                                {refreshing ? '⏳' : '🔄'} Refresh
                            </button>
                        </div>

                        {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', padding: '12px 16px', borderRadius: 12, marginBottom: 16 }}>{error}</div>}

                        {loading ? (
                            <div style={{ textAlign: 'center', padding: 80, color: 'rgba(255,255,255,0.3)' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>⏳</div>
                                <div>Loading your orders...</div>
                            </div>
                        ) : orders.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 80, background: 'rgba(255,255,255,0.03)', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
                                <div style={{ fontSize: '3rem', marginBottom: 14 }}>📭</div>
                                <h3 style={{ color: 'white', margin: '0 0 8px' }}>No orders found</h3>
                                <p style={{ color: 'rgba(255,255,255,0.4)', margin: 0 }}>
                                    {user.phone ? `No deliveries linked to ${user.phone}.` : 'Enter your phone number above to search.'}
                                </p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {orders.map(order => {
                                    const cfg = statusCfg(order.status);
                                    const isActive = order.status === 'in_transit';
                                    return (
                                        <div key={String(order.id)} style={{
                                            background: 'rgba(255,255,255,0.04)', borderRadius: 16,
                                            border: isActive ? '1px solid rgba(139,92,246,0.5)' : '1px solid rgba(255,255,255,0.07)',
                                            padding: '18px 20px', cursor: 'pointer', transition: 'all 0.2s',
                                            boxShadow: isActive ? '0 0 20px rgba(139,92,246,0.1)' : 'none'
                                        }}
                                            onClick={() => { setTab('track'); fetchRoute(order); }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                                                        <span style={{ fontWeight: 700, color: 'white', fontSize: '0.95rem' }}>
                                                            {order.customerName}
                                                        </span>
                                                        {order.emergency && (
                                                            <span style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', padding: '1px 8px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700 }}>🚨 URGENT</span>
                                                        )}
                                                    </div>
                                                    <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.82rem', marginBottom: 8 }}>
                                                        📍 {order.fullAddress || 'Address not available'}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                                        <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)' }}>
                                                            📅 {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                        </span>
                                                        {order.weight && <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)' }}>⚖️ {order.weight}kg</span>}
                                                        {order.driverName && <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)' }}>👤 {order.driverName}</span>}
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, marginLeft: 16 }}>
                                                    <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, padding: '4px 12px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                                        {cfg.emoji} {cfg.label}
                                                    </span>
                                                    <span style={{ color: 'rgba(99,102,241,0.8)', fontSize: '0.78rem', fontWeight: 600 }}>View on map →</span>
                                                </div>
                                            </div>

                                            {/* OTP Card for in_transit orders */}
                                            {order.status === 'in_transit' && order.otp && !order.otpVerified && (
                                                <div onClick={e => e.stopPropagation()} style={{ marginTop: 14, padding: '14px 16px', background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(99,102,241,0.15))', border: '1px solid rgba(139,92,246,0.4)', borderRadius: 12 }}>
                                                    <div style={{ fontWeight: 700, color: '#a78bfa', fontSize: '0.85rem', marginBottom: 8 }}>🔐 Delivery OTP</div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                        <div style={{ background: 'rgba(0,0,0,0.3)', border: '2px dashed rgba(139,92,246,0.5)', borderRadius: 10, padding: '10px 20px', letterSpacing: 6, fontWeight: 800, fontSize: '1.5rem', color: '#c4b5fd', fontFamily: 'monospace' }}>
                                                            {order.otp}
                                                        </div>
                                                        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem', lineHeight: 1.5 }}>
                                                            Share this OTP<br/>with your driver<br/>to confirm delivery
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            {order.status === 'delivered' && (
                                                <div style={{ marginTop: 10, padding: '8px 14px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10, color: '#6ee7b7', fontSize: '0.82rem', fontWeight: 600 }}>
                                                    ✅ Delivered on {order.completedAt ? new Date(order.completedAt).toLocaleDateString('en-IN') : 'N/A'}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* ─────────────────────────────── TRACK TAB ─────────────────────────────── */}
                {tab === 'track' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20, alignItems: 'start' }}>

                        {/* Left Panel */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            {/* Order Picker */}
                            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 18 }}>
                                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'rgba(255,255,255,0.6)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Select Order to Track</div>
                                {orders.length === 0 ? (
                                    <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem' }}>No orders found. Go to My Orders tab.</p>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                                        {orders.map(o => {
                                            const cfg = statusCfg(o.status);
                                            const isSelected = selectedOrder?.id === o.id;
                                            return (
                                                <button key={String(o.id)} onClick={() => fetchRoute(o)}
                                                    style={{ padding: '10px 12px', borderRadius: 10, border: isSelected ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.08)', background: isSelected ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)', color: 'white', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                                                    <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 3 }}>
                                                        {cfg.emoji} {o.customerName}
                                                    </div>
                                                    <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>
                                                        {o.fullAddress?.slice(0, 40) || 'No address'}{o.fullAddress?.length > 40 ? '…' : ''}
                                                    </div>
                                                    <span style={{ background: cfg.bg, color: cfg.color, padding: '1px 8px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700, marginTop: 4, display: 'inline-block' }}>
                                                        {cfg.label}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Order Details — with live ETA */}
                            {selectedOrder && (
                                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 18 }}>
                                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'rgba(255,255,255,0.6)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 }}>Order Details</div>
                                    {[
                                        ['Status', `${statusCfg(selectedOrder.status).emoji} ${statusCfg(selectedOrder.status).label}`],
                                        ['Address', selectedOrder.fullAddress || 'N/A'],
                                        ['Weight', selectedOrder.weight ? `${selectedOrder.weight} kg` : 'N/A'],
                                        ['Driver', selectedOrder.driverName || 'Not assigned'],
                                        ['Phone', selectedOrder.driverPhone || 'N/A'],
                                    ].map(([k, v]) => (
                                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.83rem' }}>
                                            <span style={{ color: 'rgba(255,255,255,0.4)' }}>{k}</span>
                                            <span style={{ color: 'white', fontWeight: 600, maxWidth: 170, textAlign: 'right' }}>{v}</span>
                                        </div>
                                    ))}

                                    {/* Live ETA countdown */}
                                    {selectedOrder.status === 'in_transit' && etaDisplay && (
                                        <div style={{ marginTop: 12, padding: '10px 14px', background: 'linear-gradient(135deg,rgba(99,102,241,0.2),rgba(139,92,246,0.15))', border: '1px solid rgba(99,102,241,0.35)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>⏰ ETA</span>
                                            <span style={{ fontWeight: 800, fontSize: '1.2rem', color: '#a5b4fc', letterSpacing: 0.5 }}>{etaDisplay}</span>
                                        </div>
                                    )}

                                    {/* Live driver pulsing badge */}
                                    {liveDriverLoc && (
                                        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10 }}>
                                            <span style={{ width: 8, height: 8, background: '#10b981', borderRadius: '50%', display: 'inline-block', animation: 'pulse 1.2s infinite' }} />
                                            <span style={{ fontSize: '0.8rem', color: '#6ee7b7', fontWeight: 600 }}>Driver location live</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* OTP Panel */}
                            {selectedOrder?.status === 'in_transit' && (
                                <div style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(99,102,241,0.1))', border: '1px solid rgba(139,92,246,0.35)', borderRadius: 16, padding: 18 }}>
                                    <div style={{ fontWeight: 700, color: '#a78bfa', marginBottom: 4 }}>🔐 Delivery OTP</div>
                                    <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem', margin: '0 0 12px' }}>Share this code with your driver when they arrive.</p>
                                    {selectedOrder.otp && !selectedOrder.otpVerified ? (
                                        <div style={{ background: 'rgba(0,0,0,0.3)', border: '2px dashed rgba(139,92,246,0.5)', borderRadius: 12, padding: '12px 0', textAlign: 'center', letterSpacing: 8, fontWeight: 900, fontSize: '2rem', color: '#c4b5fd', fontFamily: 'monospace', marginBottom: 12 }}>
                                            {selectedOrder.otp}
                                        </div>
                                    ) : selectedOrder.otpVerified ? (
                                        <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#6ee7b7', padding: '10px', borderRadius: 10, textAlign: 'center', fontWeight: 700 }}>✅ OTP Verified</div>
                                    ) : null}

                                    {/* Manual OTP verify input (backup for driver) */}
                                    {!selectedOrder.otpVerified && (
                                        <div>
                                            <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', marginBottom: 6 }}>Or enter OTP to verify delivery:</div>
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <input value={otpInput} onChange={e => setOtpInput(e.target.value)} placeholder="Enter OTP"
                                                    style={{ flex: 1, padding: '9px 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.07)', color: 'white', outline: 'none', fontSize: '0.9rem' }}
                                                />
                                                <button onClick={handleVerifyOtp} style={{ padding: '9px 14px', background: '#6366f1', color: 'white', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>Verify</button>
                                            </div>
                                            {otpMsg && <div style={{ marginTop: 8, fontSize: '0.82rem', color: otpMsg.startsWith('❌') ? '#fca5a5' : '#6ee7b7' }}>{otpMsg}</div>}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Route info */}
                            {routeLoading && (
                                <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 12, padding: '12px 16px', color: '#a5b4fc', fontSize: '0.85rem', textAlign: 'center' }}>
                                    🛣️ Computing road route...
                                </div>
                            )}
                        </div>

                        {/* Map */}
                        <div style={{ borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', height: 580 }}>
                            {selectedOrder ? (
                                <MapContainer center={WAREHOUSE} zoom={12} style={{ height: '100%', width: '100%' }}>
                                    <TileLayer
                                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                        attribution='&copy; OpenStreetMap contributors'
                                    />
                                    {routePolyline.length > 0 && (
                                        <>
                                            <MapFit positions={routePolyline} />
                                            <Polyline positions={routePolyline} pathOptions={{ color: '#6366f1', weight: 5, opacity: 0.85 }}>
                                                <Popup>Delivery route</Popup>
                                            </Polyline>
                                        </>
                                    )}
                                    <Marker position={WAREHOUSE} icon={warehouseIcon}>
                                        <Popup><strong>🏭 Warehouse</strong><br />Central Distribution Hub</Popup>
                                    </Marker>
                                    {selectedOrder.pickupLocation?.coordinates && (
                                        <Marker
                                            position={[selectedOrder.pickupLocation.coordinates[1], selectedOrder.pickupLocation.coordinates[0]]}
                                            icon={deliveryIcon(selectedOrder.status)}
                                        >
                                            <Popup>
                                                <strong>{selectedOrder.customerName}</strong><br />
                                                {selectedOrder.fullAddress}<br />
                                                Status: <strong>{statusCfg(selectedOrder.status).label}</strong>
                                            </Popup>
                                        </Marker>
                                    )}
                                    {/* Driver live location — updated by polling */}
                                    {liveDriverLoc ? (
                                        <Marker
                                            position={liveDriverLoc}
                                            icon={L.divIcon({ html: `<div style="background:#10b981;border:3px solid white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;box-shadow:0 2px 12px rgba(0,0,0,0.4)">🚚</div>`, className: '', iconSize: [36, 36], iconAnchor: [18, 18] })}
                                        >
                                            <Popup><strong>🚚 {selectedOrder.driverName}</strong><br />Live position · Updates every 10s{etaDisplay ? `<br />ETA: ${etaDisplay}` : ''}</Popup>
                                        </Marker>
                                    ) : selectedOrder.driverLocation?.coordinates && (
                                        <Marker
                                            position={[selectedOrder.driverLocation.coordinates[1], selectedOrder.driverLocation.coordinates[0]]}
                                            icon={L.divIcon({ html: `<div style="background:#10b981;border:3px solid white;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:1rem;box-shadow:0 2px 8px rgba(0,0,0,0.3)">🚚</div>`, className: '', iconSize: [32, 32], iconAnchor: [16, 16] })}
                                        >
                                            <Popup><strong>🚚 {selectedOrder.driverName}</strong><br />Your driver</Popup>
                                        </Marker>
                                    )}
                                </MapContainer>
                            ) : (
                                <div style={{ height: '100%', background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.25)' }}>
                                    <div style={{ fontSize: '3.5rem', marginBottom: 16 }}>🗺️</div>
                                    <div style={{ fontWeight: 600 }}>Select an order to see its route</div>
                                    <div style={{ fontSize: '0.82rem', marginTop: 6 }}>Click any order from My Orders or the list on the left</div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
