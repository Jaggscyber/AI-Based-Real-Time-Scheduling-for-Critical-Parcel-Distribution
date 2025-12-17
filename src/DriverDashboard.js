import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { useParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import polyline from '@mapbox/polyline';
import './DriverDashboard.css';

const BACKEND_URL = "http://localhost:5000";
const WAREHOUSE_COORDS = [13.0827, 80.2707];
const socket = io(BACKEND_URL, { transports: ['websocket'] });

// --- Custom Map Component to Handle Recenter ---
function MapController({ center, zoom }) {
    const map = useMap();
    useEffect(() => {
        if (center) {
            map.flyTo(center, zoom);
        }
    }, [center, zoom, map]);
    return null;
}

// --- Icons ---
const truckIcon = new L.Icon({ iconUrl: 'https://img.icons8.com/plasticine/100/000000/truck.png', iconSize: [40, 40], iconAnchor: [20, 40], popupAnchor: [0, -40] });
const warehouseIcon = L.divIcon({ html: `<div class="custom-div-icon warehouse">W</div>`, className: 'status-icon-wrapper', iconSize: [30, 30], iconAnchor: [15, 30] });
const createStatusIcon = (number, status) => {
    let color = '#3498db'; // Default Blue
    if (status === 'in_transit') color = '#f39c12'; // Orange
    if (status === 'delivered') color = '#2ecc71'; // Green
    const html = `<div class="custom-div-icon" style="background-color: ${color};">${number}</div>`;
    return L.divIcon({ html: html, className: 'status-icon-wrapper', iconSize: [30, 30], iconAnchor: [15, 30] });
};

function DriverDashboard() {
    const { driverId } = useParams();
    const [route, setRoute] = useState(null);
    const [driver, setDriver] = useState(null);
    const [currentLocation, setCurrentLocation] = useState(null);
    const [mapCenter, setMapCenter] = useState(WAREHOUSE_COORDS);
    const [mapZoom, setMapZoom] = useState(12);
    
    // States for Return Logic
    const [isRouteComplete, setIsRouteComplete] = useState(false);
    const [returnRoutePolyline, setReturnRoutePolyline] = useState(null);
    const [isReturning, setIsReturning] = useState(false);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // --- 1. Fetch Data ---
    useEffect(() => {
        const fetchDriverData = async () => {
            try {
                setLoading(true);
                const res = await axios.get(`${BACKEND_URL}/api/routes/${driverId}`);
                setRoute(res.data);
                setDriver(res.data.driver);
            } catch (err) {
                console.error(err);
                setError('No active route found or server error.');
            } finally { setLoading(false); }
        };

        if (driverId) fetchDriverData();

        // Real-time updates
        const handleScheduleUpdate = () => fetchDriverData();
        socket.on('scheduleUpdated', handleScheduleUpdate);
        return () => socket.off('scheduleUpdated', handleScheduleUpdate);
    }, [driverId]);

    // --- 2. GPS Tracking ---
    useEffect(() => {
        if (!driverId) return;
        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                const newLoc = { lat: position.coords.latitude, lng: position.coords.longitude };
                setCurrentLocation(newLoc);
                // Send live location to Admin
                socket.emit('updateDriverLocation', { 
                    driverId, 
                    location: { type: 'Point', coordinates: [newLoc.lng, newLoc.lat] } 
                });
            },
            (err) => console.error("GPS Error:", err),
            { enableHighAccuracy: true }
        );
        return () => navigator.geolocation.clearWatch(watchId);
    }, [driverId]);

    // --- 3. Check Completion ---
    useEffect(() => {
        if (route?.stops?.length > 0) {
            const allDelivered = route.stops.every(stop => stop.status === 'delivered');
            setIsRouteComplete(allDelivered);
        }
    }, [route]);

    // --- Handlers ---
    const handleStatusUpdate = async (deliveryId, newStatus) => {
        try {
            await axios.put(`${BACKEND_URL}/api/deliveries/${deliveryId}/status`, { status: newStatus });
            // Optimistic update for smoother UI
            setRoute(prev => ({
                ...prev,
                stops: prev.stops.map(s => s._id === deliveryId ? { ...s, status: newStatus } : s)
            }));
        } catch (err) { alert("Status update failed."); }
    };

    const handleCalculateReturn = async () => {
        if (!currentLocation) { alert("Waiting for GPS..."); return; }
        try {
            const res = await axios.post(`${BACKEND_URL}/api/routes/recalculate`, { driverId, currentLocation });
            if (res.data.polyline) {
                setReturnRoutePolyline(res.data.polyline);
                setIsReturning(true);
                // Zoom out to show whole path
                setMapCenter(WAREHOUSE_COORDS);
                setMapZoom(11);
            }
        } catch (err) { alert("Could not calculate return route."); }
    };

    const handleConfirmArrival = async () => {
        try {
            await axios.post(`${BACKEND_URL}/api/drivers/${driverId}/return-to-warehouse`);
            alert("Shift Completed! You are now marked 'Available'.");
            window.location.reload(); // Refresh to clear state
        } catch (err) { alert("Error completing shift."); }
    };

    const focusOnStop = (stop) => {
        setMapCenter([stop.pickupLocation.coordinates[1], stop.pickupLocation.coordinates[0]]);
        setMapZoom(15);
    };

    const focusOnTruck = () => {
        if(currentLocation) {
            setMapCenter([currentLocation.lat, currentLocation.lng]);
            setMapZoom(16);
        }
    };

    if (loading) return <div className="loading-screen">Loading Route...</div>;

    const noRouteAssigned = !route || !route.stops || route.stops.length === 0 || route.status === 'inactive';
    const decodedPolyline = route?.polyline ? polyline.decode(route.polyline) : [];
    const decodedReturnPolyline = returnRoutePolyline ? polyline.decode(returnRoutePolyline) : [];

    return (
        <div className="driver-dashboard">
            <header className="driver-header">
                <div>
                    <h1>{driver?.name || 'Driver'}</h1>
                    <span className="subtitle">{isRouteComplete ? 'Return to Base' : 'Active Delivery Route'}</span>
                </div>
                {route && !noRouteAssigned && (
                    <div className="route-stats">
                        <span>⏱ {route.totalDuration || '0 min'}</span>
                        <span>📏 {route.totalDistance || '0 km'}</span>
                    </div>
                )}
            </header>

            <div className="driver-main-content">
                {/* --- MAP SECTION --- */}
                <div className="driver-map-container">
                    <MapContainer center={WAREHOUSE_COORDS} zoom={12} style={{ height: '100%', width: '100%' }}>
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        <MapController center={mapCenter} zoom={mapZoom} />
                        
                        {/* Markers */}
                        <Marker position={WAREHOUSE_COORDS} icon={warehouseIcon}><Popup>Warehouse</Popup></Marker>
                        
                        {currentLocation && (
                            <Marker position={[currentLocation.lat, currentLocation.lng]} icon={truckIcon}>
                                <Popup>You</Popup>
                            </Marker>
                        )}

                        {/* Stop Markers */}
                        {!noRouteAssigned && route.stops.map((stop, index) => (
                            <Marker 
                                key={stop._id} 
                                position={[stop.pickupLocation.coordinates[1], stop.pickupLocation.coordinates[0]]} 
                                icon={createStatusIcon(index + 1, stop.status)}
                            >
                                <Popup>
                                    <strong>{stop.customerName}</strong><br/>
                                    {stop.fullAddress}
                                </Popup>
                            </Marker>
                        ))}

                        {/* Routes */}
                        {!isReturning && decodedPolyline.length > 0 && <Polyline positions={decodedPolyline} color="#3498db" weight={5} />}
                        {decodedReturnPolyline.length > 0 && <Polyline positions={decodedReturnPolyline} color="#27ae60" weight={5} dashArray="10, 10" />}
                    </MapContainer>

                    {/* Floating GPS Button */}
                    <button className="recenter-btn" onClick={focusOnTruck}>📍</button>
                </div>

                {/* --- SIDEBAR / BOTTOM PANEL --- */}
                <div className="driver-stops-panel">
                    {/* COMPLETE STATE */}
                    {isRouteComplete ? (
                        <div className="return-panel">
                            <h3>🎉 All Deliveries Done!</h3>
                            <p>Please return to the warehouse.</p>
                            
                            {!isReturning ? (
                                <button className="action-btn return-btn" onClick={handleCalculateReturn}>
                                    Navigate to Warehouse
                                </button>
                            ) : (
                                <div className="arrival-confirmation">
                                    <p className="instruction">Follow the green line.</p>
                                    <button className="action-btn confirm-btn" onClick={handleConfirmArrival}>
                                        🔴 I Have Arrived (End Shift)
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : noRouteAssigned ? (
                        <div className="empty-state">
                            <h3>No Active Route</h3>
                            <p>Waiting for dispatcher...</p>
                        </div>
                    ) : (
                        // DELIVERY LIST
                        <div className="stops-list">
                            {route.stops.map((stop, index) => (
                                <div key={stop._id} className={`stop-card ${stop.status}`}>
                                    <div className="stop-header">
                                        <span className="stop-number">#{index + 1}</span>
                                        <div className="stop-info">
                                            <h4>{stop.customerName}</h4>
                                            <p className="address">{stop.fullAddress || 'No Address Provided'}</p>
                                        </div>
                                    </div>
                                    
                                    <div className="stop-details">
                                        {stop.customerPhone && (
                                            <a href={`tel:${stop.customerPhone}`} className="phone-link">
                                                📞 {stop.customerPhone}
                                            </a>
                                        )}
                                        <span className="weight-tag">{stop.weight || 5}kg</span>
                                    </div>

                                    <div className="stop-actions">
                                        <button className="secondary-btn" onClick={() => focusOnStop(stop)}>Map</button>
                                        
                                        {stop.status === 'assigned' && (
                                            <button className="primary-btn" onClick={() => handleStatusUpdate(stop._id, 'in_transit')}>Start</button>
                                        )}
                                        {stop.status === 'in_transit' && (
                                            <button className="success-btn" onClick={() => handleStatusUpdate(stop._id, 'delivered')}>Delivered</button>
                                        )}
                                        {stop.status === 'delivered' && (
                                            <span className="done-badge">✓ Done</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default DriverDashboard;