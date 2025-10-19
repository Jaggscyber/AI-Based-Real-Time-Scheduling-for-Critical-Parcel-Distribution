import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { useParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import polyline from '@mapbox/polyline';
import './DriverDashboard.css';

const BACKEND_URL = "http://localhost:5001";
const WAREHOUSE_COORDS = [13.0827, 80.2707];
const socket = io(BACKEND_URL, { transports: ['websocket'] });

const truckIcon = new L.Icon({ iconUrl: 'https://img.icons8.com/plasticine/100/000000/truck.png', iconSize: [40, 40], iconAnchor: [20, 40], popupAnchor: [0, -40] });
const createStatusIcon = (number, status) => {
    let color = '#3498db'; if (status === 'in_transit') color = '#f39c12'; if (status === 'delivered') color = '#2ecc71';
    const html = `<div class="custom-div-icon" style="background-color: ${color};">${number}</div>`;
    return L.divIcon({ html: html, className: 'status-icon-wrapper', iconSize: [30, 30], iconAnchor: [15, 30] });
};
const warehouseIcon = L.divIcon({ html: `<div class="custom-div-icon warehouse">W</div>`, className: 'status-icon-wrapper', iconSize: [30, 30], iconAnchor: [15, 30] });

function DriverDashboard() {
    const { driverId } = useParams();
    const [route, setRoute] = useState(null);
    const [driver, setDriver] = useState(null);
    const [currentLocation, setCurrentLocation] = useState(null);
    const [locationStatus, setLocationStatus] = useState('initializing');
    const [isRouteComplete, setIsRouteComplete] = useState(false);
    const [returnRoutePolyline, setReturnRoutePolyline] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const mapRef = useRef();

    useEffect(() => {
        const fetchDriverData = async () => {
            try {
                setLoading(true);
                const res = await axios.get(`${BACKEND_URL}/api/routes/${driverId}`);
                setRoute(res.data);
                setDriver(res.data.driver);
            } catch (err) {
                setError(err.response?.status === 404 ? 'No route found.' : 'Failed to fetch data.');
            } finally { setLoading(false); }
        };
        if (driverId) fetchDriverData();
        const handleScheduleUpdate = () => fetchDriverData();
        socket.on('scheduleUpdated', handleScheduleUpdate);
        return () => socket.off('scheduleUpdated', handleScheduleUpdate);
    }, [driverId]);

    useEffect(() => {
        if (!driverId) return;
        setLocationStatus('initializing');
        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                setLocationStatus('active');
                const newLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
                setCurrentLocation(newLocation);
                socket.emit('updateDriverLocation', { driverId, location: { type: 'Point', coordinates: [newLocation.lng, newLocation.lat] } });
            },
            (err) => { setLocationStatus('denied'); }, { enableHighAccuracy: true }
        );
        return () => navigator.geolocation.clearWatch(watchId);
    }, [driverId]);

    useEffect(() => {
        const allDelivered = route?.stops?.length > 0 && route.stops.every(stop => stop.status === 'delivered');
        setIsRouteComplete(allDelivered);
    }, [route]);
    
    useEffect(() => {
        const { current: map } = mapRef;
        if (!map) return;
        if (route?.stops?.length > 0 && !isRouteComplete) {
            const allPoints = [ WAREHOUSE_COORDS, ...route.stops.map(stop => [stop.pickupLocation.coordinates[1], stop.pickupLocation.coordinates[0]]) ];
            if (currentLocation) allPoints.push([currentLocation.lat, currentLocation.lng]);
            map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] });
        } else if (currentLocation) {
            map.setView([currentLocation.lat, currentLocation.lng], 13);
        } else {
            map.setView(WAREHOUSE_COORDS, 12);
        }
    }, [route, currentLocation, isRouteComplete]);

    const handleStatusUpdate = async (deliveryId, newStatus) => {
        try {
            await axios.put(`${BACKEND_URL}/api/deliveries/${deliveryId}/status`, { status: newStatus });
        } catch (err) {
            alert("Failed to update status.");
        }
    };
    
    const handleReturnToWarehouse = async () => {
        if (!currentLocation) {
            alert("Waiting for GPS. Please ensure location services are enabled.");
            return;
        }
        try {
            const res = await axios.post(`${BACKEND_URL}/api/routes/recalculate`, { driverId, currentLocation });
            if (res.data.polyline) setReturnRoutePolyline(res.data.polyline);
            await axios.post(`${BACKEND_URL}/api/drivers/${driverId}/return-to-warehouse`);
        } catch (err) {
            alert("Could not calculate return route.");
        }
    };

    const handleGoToDelivery = (stop) => {
        const { current: map } = mapRef;
        if (map) map.setView([stop.pickupLocation.coordinates[1], stop.pickupLocation.coordinates[0]], 15, { animate: true });
    };
    
    if (loading) return <div>Loading...</div>;
    if (error) return <div>{error}</div>;

    const noRouteAssigned = !route || !route.stops || route.stops.length === 0 || route.status === 'inactive';
    const decodedPolyline = route?.polyline ? polyline.decode(route.polyline) : [];
    const decodedReturnPolyline = returnRoutePolyline ? polyline.decode(returnRoutePolyline) : [];

    return (
        <div className="driver-dashboard">
            <header className="driver-header">
                <h1>{isRouteComplete ? 'Route Completed' : noRouteAssigned ? 'Awaiting Assignment' : 'Your Optimized Route'}</h1>
                <div className="route-summary"><span><strong>Driver:</strong> {driver?.name || '...'}</span><span><strong>Time:</strong> {route?.totalDuration || 'N/A'}</span><span><strong>Distance:</strong> {route?.totalDistance || 'N/A'}</span></div>
            </header>
            <div className="driver-main-content">
                <div className="driver-map-container">
                    <MapContainer ref={mapRef} center={WAREHOUSE_COORDS} zoom={12}>
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        <Marker position={WAREHOUSE_COORDS} icon={warehouseIcon}><Popup>Main Warehouse</Popup></Marker>
                        {currentLocation && <Marker position={[currentLocation.lat, currentLocation.lng]} icon={truckIcon}><Popup>Your current location</Popup></Marker>}
                        {!isRouteComplete && route?.stops?.map((stop, index) => (<Marker key={stop._id} position={[stop.pickupLocation.coordinates[1], stop.pickupLocation.coordinates[0]]} icon={createStatusIcon(index + 1, stop.status)}><Popup><b>Stop {index + 1}</b></Popup></Marker>))}
                        {!isRouteComplete && decodedPolyline.length > 0 && <Polyline positions={decodedPolyline} color="#007bff" weight={6} />}
                        {decodedReturnPolyline.length > 0 && <Polyline positions={decodedReturnPolyline} color="#28a745" weight={6} dashArray="10, 10" />}
                    </MapContainer>
                </div>
                <div className="driver-stops-panel">
                    <h2>Delivery Stops</h2>
                    <div className="stops-list">
                        {isRouteComplete ? (
                             <div className="stop-card delivered">
                                 <h3>All deliveries complete!</h3>
                                 <p>You can now return to the warehouse.</p>
                                 {locationStatus === 'denied' && <p className="error-text">Enable location services to calculate return route.</p>}
                                 <div className="stop-actions">
                                     <button onClick={handleReturnToWarehouse} className="return-warehouse-btn" disabled={locationStatus !== 'active'}>
                                         {locationStatus === 'active' ? 'Show Route to Warehouse' : 'Acquiring Location...'}
                                     </button>
                                 </div>
                             </div>
                        ) : noRouteAssigned ? (
                            <div className="stop-card"><h3>No Route Assigned</h3><p>Please wait for a new schedule.</p></div>
                        ) : (
                            route.stops.map((stop, index) => (
                                <div key={stop._id} className={`stop-card ${stop.status}`}>
                                    <h3>Stop {index + 1}: Delivery #{stop._id.slice(-6)}</h3>
                                    <p><strong>Status:</strong> {stop.status.replace('_', ' ').toUpperCase()}</p>
                                    <div className="stop-actions">
                                        <button className="goto-btn" onClick={() => handleGoToDelivery(stop)}>Show on Map</button>
                                        {stop.status === 'assigned' && <button onClick={() => handleStatusUpdate(stop._id, 'in_transit')}>Start Driving</button>}
                                        {stop.status === 'in_transit' && <button onClick={() => handleStatusUpdate(stop._id, 'delivered')}>Mark Delivered</button>}
                                        {stop.status === 'delivered' && <p className="completed-text">✓ Completed</p>}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default DriverDashboard;