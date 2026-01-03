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

function MapController({ center, zoom }) {
    const map = useMap();
    useEffect(() => {
        if (center) map.flyTo(center, zoom);
    }, [center, zoom, map]);
    return null;
}

const truckIcon = new L.Icon({ iconUrl: 'https://img.icons8.com/plasticine/100/000000/truck.png', iconSize: [40, 40], iconAnchor: [20, 40], popupAnchor: [0, -40] });
const warehouseIcon = L.divIcon({ html: `<div class="custom-div-icon warehouse">W</div>`, className: 'status-icon-wrapper', iconSize: [30, 30], iconAnchor: [15, 30] });
const createStatusIcon = (number, status) => {
    let color = '#3498db'; 
    if (status === 'in_transit') color = '#f39c12';
    if (status === 'delivered') color = '#2ecc71';
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
    
    const [isRouteComplete, setIsRouteComplete] = useState(false);
    const [returnRoutePolyline, setReturnRoutePolyline] = useState(null);
    const [isReturning, setIsReturning] = useState(false);

    // --- FOCUS MODE STATES ---
    const [viewMode, setViewMode] = useState('full'); // 'full' | 'focus'
    const [focusedStop, setFocusedStop] = useState(null);
    const [focusedPolyline, setFocusedPolyline] = useState(null); // Stores the single leg line

    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchDriverData = async () => {
            try {
                setLoading(true);
                const res = await axios.get(`${BACKEND_URL}/api/routes/${driverId}`);
                setRoute(res.data);
                setDriver(res.data.driver);
            } catch (err) {
                console.error(err);
            } finally { setLoading(false); }
        };
        if (driverId) fetchDriverData();
        
        const handleUpdate = () => fetchDriverData();
        socket.on('scheduleUpdated', handleUpdate);
        return () => socket.off('scheduleUpdated', handleUpdate);
    }, [driverId]);

    useEffect(() => {
        if (!driverId) return;
        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                const newLoc = { lat: position.coords.latitude, lng: position.coords.longitude };
                setCurrentLocation(newLoc);
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

    useEffect(() => {
        if (route?.stops?.length > 0) {
            const allDelivered = route.stops.every(stop => stop.status === 'delivered');
            setIsRouteComplete(allDelivered);
        }
    }, [route]);

    const handleStatusUpdate = async (deliveryId, newStatus) => {
        try {
            await axios.put(`${BACKEND_URL}/api/deliveries/${deliveryId}/status`, { status: newStatus });
            setRoute(prev => ({
                ...prev,
                stops: prev.stops.map(s => s._id === deliveryId ? { ...s, status: newStatus } : s)
            }));
            if(focusedStop && focusedStop._id === deliveryId && newStatus === 'delivered') {
                handleClearFocus();
            }
        } catch (err) { alert("Status update failed."); }
    };

    const handleCalculateReturn = async () => {
        if (!currentLocation) { alert("Waiting for GPS..."); return; }
        try {
            const res = await axios.post(`${BACKEND_URL}/api/routes/recalculate`, { driverId, currentLocation });
            if (res.data.polyline) {
                setReturnRoutePolyline(res.data.polyline);
                setIsReturning(true);
                setMapCenter(WAREHOUSE_COORDS);
                setMapZoom(11);
            }
        } catch (err) { alert("Could not calculate return route."); }
    };

    const handleConfirmArrival = async () => {
        try {
            await axios.post(`${BACKEND_URL}/api/drivers/${driverId}/return-to-warehouse`);
            alert("Shift Completed!");
            window.location.reload(); 
        } catch (err) { alert("Error completing shift."); }
    };

    // --- NEW: FOCUS MAP LOGIC ---
    const handleFocusStop = async (stop) => {
        if(viewMode === 'focus' && focusedStop?._id === stop._id) {
            handleClearFocus(); 
            return;
        }

        // 1. Set View State
        setFocusedStop(stop);
        setViewMode('focus');
        setMapCenter([stop.pickupLocation.coordinates[1], stop.pickupLocation.coordinates[0]]);
        setMapZoom(14);

        // 2. Fetch the "Green Line" (Route Leg) from Backend
        if (currentLocation) {
            try {
                const res = await axios.post(`${BACKEND_URL}/api/routes/leg`, {
                    start: currentLocation, // {lat, lng}
                    end: stop.pickupLocation.coordinates // [lng, lat]
                });
                if(res.data.polyline) {
                    setFocusedPolyline(res.data.polyline);
                }
            } catch (e) {
                console.error("Could not fetch leg path", e);
            }
        }
    };

    const handleClearFocus = () => {
        setFocusedStop(null);
        setFocusedPolyline(null);
        setViewMode('full');
        setMapZoom(12);
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
    const decodedFocusedPolyline = focusedPolyline ? polyline.decode(focusedPolyline) : [];

    return (
        <div className="driver-dashboard">
            <header className="driver-header">
                <div>
                    <h1>{driver?.name || 'Driver'}</h1>
                    <span className="subtitle">{isRouteComplete ? 'Return to Base' : (viewMode === 'focus' ? 'Navigation Mode' : 'Active Delivery Route')}</span>
                </div>
            </header>

            <div className="driver-main-content">
                <div className="driver-map-container">
                    <MapContainer center={WAREHOUSE_COORDS} zoom={12} style={{ height: '100%', width: '100%' }}>
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        <MapController center={mapCenter} zoom={mapZoom} />
                        
                        <Marker position={WAREHOUSE_COORDS} icon={warehouseIcon}><Popup>Warehouse</Popup></Marker>
                        
                        {currentLocation && (
                            <Marker position={[currentLocation.lat, currentLocation.lng]} icon={truckIcon}>
                                <Popup>You</Popup>
                            </Marker>
                        )}

                        {/* --- VIEW MODE: FULL --- */}
                        {viewMode === 'full' && !noRouteAssigned && route.stops.map((stop, index) => (
                            <Marker 
                                key={stop._id} 
                                position={[stop.pickupLocation.coordinates[1], stop.pickupLocation.coordinates[0]]} 
                                icon={createStatusIcon(index + 1, stop.status)}
                            >
                                <Popup><strong>{stop.customerName}</strong></Popup>
                            </Marker>
                        ))}

                        {/* --- VIEW MODE: FOCUS (Hide everything else) --- */}
                        {viewMode === 'focus' && focusedStop && (
                            <Marker 
                                position={[focusedStop.pickupLocation.coordinates[1], focusedStop.pickupLocation.coordinates[0]]} 
                                icon={createStatusIcon('🎯', focusedStop.status)}
                            >
                                <Popup>TARGET: {focusedStop.customerName}</Popup>
                            </Marker>
                        )}

                        {/* --- ROUTES --- */}
                        {/* 1. Full Route (Blue) */}
                        {viewMode === 'full' && !isReturning && decodedPolyline.length > 0 && (
                            <Polyline positions={decodedPolyline} color="#3498db" weight={5} />
                        )}
                        
                        {/* 2. Focused Leg (Green) */}
                        {viewMode === 'focus' && decodedFocusedPolyline.length > 0 && (
                            <Polyline positions={decodedFocusedPolyline} color="#2ecc71" weight={6} />
                        )}

                        {/* 3. Return Route (Dashed Green) */}
                        {decodedReturnPolyline.length > 0 && (
                            <Polyline positions={decodedReturnPolyline} color="#27ae60" weight={5} dashArray="10, 10" />
                        )}

                    </MapContainer>

                    <button className="recenter-btn" onClick={focusOnTruck}>📍</button>
                    {viewMode === 'focus' && (
                        <button 
                            className="recenter-btn" 
                            style={{ bottom: '80px', color: 'red', fontWeight: 'bold' }} 
                            onClick={handleClearFocus}
                        >
                            ✖
                        </button>
                    )}
                </div>

                <div className="driver-stops-panel">
                    {isRouteComplete ? (
                        <div className="return-panel">
                            <h3>🎉 All Deliveries Done!</h3>
                            <button className="action-btn return-btn" onClick={handleCalculateReturn}>Navigate to Warehouse</button>
                        </div>
                    ) : noRouteAssigned ? (
                        <div className="empty-state"><h3>No Active Route</h3></div>
                    ) : (
                        <div className="stops-list">
                            {route.stops.map((stop, index) => {
                                const isFocused = focusedStop?._id === stop._id;
                                return (
                                    <div key={stop._id} className={`stop-card ${stop.status} ${isFocused ? 'focused-card' : ''}`}>
                                        <div className="stop-header">
                                            <span className="stop-number">#{index + 1}</span>
                                            <div className="stop-info"><h4>{stop.customerName}</h4></div>
                                        </div>
                                        <div className="stop-actions">
                                            <button 
                                                className="secondary-btn map-btn" 
                                                onClick={() => handleFocusStop(stop)}
                                                style={{ background: isFocused ? '#e74c3c' : '#ecf0f1', color: isFocused ? 'white' : '#2c3e50' }}
                                            >
                                                {isFocused ? 'Clear Map' : 'Map'}
                                            </button>
                                            {stop.status === 'assigned' && <button className="primary-btn" onClick={() => handleStatusUpdate(stop._id, 'in_transit')}>Start</button>}
                                            {stop.status === 'in_transit' && <button className="success-btn" onClick={() => handleStatusUpdate(stop._id, 'delivered')}>Delivered</button>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default DriverDashboard;