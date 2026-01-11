import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { useParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
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

    // --- ALERT STATES ---
    const [alerts, setAlerts] = useState([]);
    const [showAlert, setShowAlert] = useState(false);
    const [currentAlert, setCurrentAlert] = useState(null);

    // --- ROUTE UPDATE TRACKING ---
    const [previousRoute, setPreviousRoute] = useState(null);
    const [routeUpdated, setRouteUpdated] = useState(false);

    // --- RANGE TRACKING ---
    const [remainingRange, setRemainingRange] = useState(300); // Default 300km for EV
    const [totalRange, setTotalRange] = useState(300);
    const [chargingStations, setChargingStations] = useState([]);
    const [petrolStations, setPetrolStations] = useState([]);

    const [loading, setLoading] = useState(true);

    // --- RANGE CALCULATION FUNCTIONS ---
    const calculateRange = (distanceTraveled) => {
        const consumptionRate = driver?.vehicleType === 'EV' ? 15 : 8; // kWh/100km for EV, L/100km for petrol
        const rangeUsed = (distanceTraveled * consumptionRate) / 100;
        return Math.max(0, totalRange - rangeUsed);
    };

    const fetchNearbyStations = async (location) => {
        try {
            // Mock charging stations around Chennai area
            const mockStations = [
                { id: 1, name: 'Tesla Supercharger T.Nagar', lat: 13.0827, lng: 80.2707, type: 'charging' },
                { id: 2, name: 'Ather Grid Anna Nagar', lat: 13.0850, lng: 80.2100, type: 'charging' },
                { id: 3, name: 'Bharat Petroleum Adyar', lat: 13.0067, lng: 80.2572, type: 'petrol' },
                { id: 4, name: 'Indian Oil Teynampet', lat: 13.0400, lng: 80.2500, type: 'petrol' },
                { id: 5, name: 'HP Petrol Bunk Velachery', lat: 12.9750, lng: 80.2200, type: 'petrol' },
                { id: 6, name: 'ChargePoint Marina Beach', lat: 13.0827, lng: 80.2707, type: 'charging' }
            ];
            
            const charging = mockStations.filter(s => s.type === 'charging');
            const petrol = mockStations.filter(s => s.type === 'petrol');
            
            setChargingStations(charging);
            setPetrolStations(petrol);
        } catch (err) {
            console.error('Error fetching stations:', err);
        }
    };

    // --- ALERT FUNCTIONS ---
    const showTrafficAlert = (message) => {
        const alert = {
            id: Date.now(),
            type: 'traffic',
            message: message,
            timestamp: new Date()
        };
        setAlerts(prev => [alert, ...prev]);
        setCurrentAlert(alert);
        setShowAlert(true);
        
        // Auto-hide after 10 seconds
        setTimeout(() => {
            setShowAlert(false);
            setCurrentAlert(null);
        }, 10000);
    };

    const dismissAlert = () => {
        setShowAlert(false);
        setCurrentAlert(null);
    };

    useEffect(() => {
        const fetchDriverData = async () => {
            try {
                setLoading(true);
                const res = await axios.get(`${BACKEND_URL}/api/routes/${driverId}`);
                setRoute(res.data);
                setDriver(res.data.driver);
                
                // Initialize range based on vehicle type
                if (res.data.driver?.vehicleType === 'EV') {
                    setTotalRange(300); // 300km for EV
                    setRemainingRange(300);
                } else {
                    setTotalRange(400); // 400km for petrol vehicles
                    setRemainingRange(400);
                }
                
                // Fetch nearby stations
                fetchNearbyStations({ lat: 13.0827, lng: 80.2707 });
            } catch (err) {
                console.error(err);
            } finally { setLoading(false); }
        };
        if (driverId) fetchDriverData();
        
        const handleUpdate = (data) => {
            const oldRoute = route;
            fetchDriverData();
            if (data?.message && data.message.includes('blockages')) {
                showTrafficAlert('🚧 Route updated due to traffic conditions! New optimized route has been assigned.');
                setPreviousRoute(oldRoute);
                setRouteUpdated(true);
                // Auto-clear after 30 seconds
                setTimeout(() => {
                    setRouteUpdated(false);
                    setPreviousRoute(null);
                }, 30000);
            }
        };
        socket.on('scheduleUpdated', handleUpdate);
        return () => socket.off('scheduleUpdated', handleUpdate);
    }, [driverId]);

    // --- GPS LOCATION TRACKING WITH RANGE ---
    const [lastLocation, setLastLocation] = useState(null);
    const [totalDistanceTraveled, setTotalDistanceTraveled] = useState(0);

    const calculateDistance = (lat1, lng1, lat2, lng2) => {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    };

    useEffect(() => {
        if (!driverId) return;
        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                const newLoc = { lat: position.coords.latitude, lng: position.coords.longitude };
                setCurrentLocation(newLoc);
                
                // Calculate distance traveled and update range
                if (lastLocation) {
                    const distance = calculateDistance(
                        lastLocation.lat, lastLocation.lng,
                        newLoc.lat, newLoc.lng
                    );
                    const newTotalDistance = totalDistanceTraveled + distance;
                    setTotalDistanceTraveled(newTotalDistance);
                    
                    // Update remaining range
                    const newRemainingRange = calculateRange(newTotalDistance);
                    setRemainingRange(newRemainingRange);
                }
                
                setLastLocation(newLoc);
                
                socket.emit('updateDriverLocation', { 
                    driverId, 
                    location: { type: 'Point', coordinates: [newLoc.lng, newLoc.lat] } 
                });
            },
            (err) => console.error("GPS Error:", err),
            { enableHighAccuracy: true }
        );
        return () => navigator.geolocation.clearWatch(watchId);
    }, [driverId, lastLocation, totalDistanceTraveled]);

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
    const decodedPolyline = route?.polyline ? JSON.parse(route.polyline) : [];
    const decodedReturnPolyline = returnRoutePolyline ? JSON.parse(returnRoutePolyline) : [];
    const decodedFocusedPolyline = focusedPolyline ? JSON.parse(focusedPolyline) : [];

    return (
        <div className="driver-dashboard">
            <header className="driver-header">
                <div>
                    <h1>{driver?.name || 'Driver'}</h1>
                    <span className="subtitle">
                        {isRouteComplete ? 'Return to Base' : (viewMode === 'focus' ? 'Navigation Mode' : 'Active Delivery Route')}
                        {routeUpdated && <span style={{color: '#e74c3c', fontWeight: 'bold', marginLeft: '10px'}}>🔄 ROUTE UPDATED</span>}
                    </span>
                </div>
                <div className="driver-status">
                    <div className="range-indicator" style={{
                        background: remainingRange < 50 ? '#e74c3c' : remainingRange < 100 ? '#f39c12' : '#27ae60',
                        color: 'white',
                        padding: '8px 12px',
                        borderRadius: '20px',
                        fontSize: '0.9rem',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px'
                    }}>
                        {driver?.vehicleType === 'EV' ? '⚡' : '⛽'} 
                        {remainingRange.toFixed(1)} / {totalRange} km
                        {remainingRange < 50 && <span style={{fontSize: '1.2rem'}}>⚠️</span>}
                    </div>
                </div>
            </header>

            {/* TRAFFIC ALERT */}
            {showAlert && currentAlert && (
                <div className="traffic-alert" style={{
                    background: 'linear-gradient(135deg, #ff6b6b, #ee5a24)',
                    color: 'white',
                    padding: '15px 20px',
                    margin: '0 20px',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    animation: 'slideDown 0.5s ease-out'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '1.5rem' }}>🚨</span>
                        <div>
                            <strong>Route Update Alert</strong>
                            <p style={{ margin: '5px 0 0 0', fontSize: '0.9rem', opacity: 0.9 }}>
                                {currentAlert.message}
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={dismissAlert}
                        style={{
                            background: 'rgba(255,255,255,0.2)',
                            border: 'none',
                            color: 'white',
                            padding: '5px 10px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '1.2rem'
                        }}
                    >
                        ×
                    </button>
                </div>
            )}

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

                        {/* --- CHARGING & PETROL STATIONS --- */}
                        {driver?.vehicleType === 'EV' && chargingStations.map(station => (
                            <Marker 
                                key={`charging-${station.id}`} 
                                position={[station.lat, station.lng]}
                                icon={L.divIcon({
                                    html: `<div style="background: #27ae60; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold;">⚡</div>`,
                                    className: 'charging-station-icon',
                                    iconSize: [30, 30],
                                    iconAnchor: [15, 15]
                                })}
                            >
                                <Popup>
                                    <strong>{station.name}</strong><br/>
                                    <span style={{color: '#27ae60'}}>⚡ EV Charging Station</span><br/>
                                    <button 
                                        onClick={() => alert(`Navigate to ${station.name}?`)}
                                        style={{background: '#27ae60', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '3px', marginTop: '5px'}}
                                    >
                                        Navigate Here
                                    </button>
                                </Popup>
                            </Marker>
                        ))}

                        {driver?.vehicleType !== 'EV' && petrolStations.map(station => (
                            <Marker 
                                key={`petrol-${station.id}`} 
                                position={[station.lat, station.lng]}
                                icon={L.divIcon({
                                    html: `<div style="background: #e74c3c; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold;">⛽</div>`,
                                    className: 'petrol-station-icon',
                                    iconSize: [30, 30],
                                    iconAnchor: [15, 15]
                                })}
                            >
                                <Popup>
                                    <strong>{station.name}</strong><br/>
                                    <span style={{color: '#e74c3c'}}>⛽ Petrol Station</span><br/>
                                    <button 
                                        onClick={() => alert(`Navigate to ${station.name}?`)}
                                        style={{background: '#e74c3c', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '3px', marginTop: '5px'}}
                                    >
                                        Navigate Here
                                    </button>
                                </Popup>
                            </Marker>
                        ))}

                        {/* --- ROUTES --- */}
                        {/* 1. Previous Route (Gray/Dashed) - Show when route was updated */}
                        {routeUpdated && previousRoute?.polyline && viewMode === 'full' && !isReturning && (
                            <Polyline 
                                positions={JSON.parse(previousRoute.polyline)} 
                                color="#6c757d" 
                                weight={3}
                                opacity={0.5}
                                dashArray="5, 10"
                            >
                                <Popup>Previous Route (before traffic update)</Popup>
                            </Polyline>
                        )}
                        
                        {/* 2. Current Route (Blue) */}
                        {viewMode === 'full' && !isReturning && decodedPolyline.length > 0 && (
                            <Polyline positions={decodedPolyline} color="#3498db" weight={5}>
                                <Popup>Current Optimized Route {routeUpdated ? '(traffic-aware)' : ''}</Popup>
                            </Polyline>
                        )}
                        
                        {/* 3. Focused Leg (Green) */}
                        {viewMode === 'focus' && decodedFocusedPolyline.length > 0 && (
                            <Polyline positions={decodedFocusedPolyline} color="#2ecc71" weight={6} />
                        )}

                        {/* 4. Return Route (Dashed Green) */}
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