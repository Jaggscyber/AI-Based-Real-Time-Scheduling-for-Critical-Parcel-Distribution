import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import polyline from '@mapbox/polyline';
import './DriverDashboard.css';

const BACKEND_URL = "http://localhost:5001";
const WAREHOUSE_COORDS = [13.0827, 80.2707];

const truckIcon = new L.Icon({
    iconUrl: 'https://img.icons8.com/plasticine/100/000000/truck.png',
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
});

function DriverDashboard() {
    const { driverId } = useParams();
    const [route, setRoute] = useState(null);
    const [driver, setDriver] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const mapRef = useRef();

    useEffect(() => {
        const fetchDriverData = async () => {
            try {
                // This API call now always returns a successful response if the driver exists
                const res = await axios.get(`${BACKEND_URL}/api/routes/${driverId}`);
                setRoute(res.data);
                setDriver(res.data.driver); // Set driver state from the response
            } catch (err) {
                // The catch block will now only run for actual errors (e.g., server down or a true 404)
                if (err.response && err.response.status === 404) {
                    setError('Driver not found.');
                } else {
                    setError('An error occurred while fetching data.');
                }
                console.error("Failed to fetch driver data:", err);
            } finally {
                setLoading(false);
            }
        };
        if (driverId) fetchDriverData();
    }, [driverId]);

    // This effect handles zooming the map
    useEffect(() => {
        const { current: map } = mapRef;
        if (!map) return;

        if (route?.stops?.length > 0) {
            // If there are stops, fit them all in the view
            const allPoints = [ WAREHOUSE_COORDS, ...route.stops.map(stop => [stop.pickupLocation.coordinates[1], stop.pickupLocation.coordinates[0]]) ];
            const bounds = L.latLngBounds(allPoints);
            map.fitBounds(bounds, { padding: [50, 50] });
        } else if (driver?.currentLocation?.coordinates) {
            // If no stops, just center on the driver's last known location
            const coords = [driver.currentLocation.coordinates[1], driver.currentLocation.coordinates[0]];
            map.setView(coords, 13);
        }
    }, [route, driver, mapRef]);

    const handleStatusUpdate = async (deliveryId, newStatus) => {
        try {
            await axios.put(`${BACKEND_URL}/api/deliveries/${deliveryId}/status`, { status: newStatus });
            // Re-fetch data after update
            const res = await axios.get(`${BACKEND_URL}/api/routes/${driverId}`);
            setRoute(res.data);
            setDriver(res.data.driver);
        } catch (err) {
            alert("Failed to update status.");
        }
    };

    const handleGoToDelivery = (stop) => {
        const { current: map } = mapRef;
        if (map) {
            const coords = [stop.pickupLocation.coordinates[1], stop.pickupLocation.coordinates[0]];
            map.setView(coords, 15, { animate: true });
        }
    };

    const createNumberedIcon = (number) => {
        return L.divIcon({
            html: `<div class="marker-number">${number}</div>`,
            className: number === 'W' ? 'custom-div-icon warehouse' : 'custom-div-icon',
            iconSize: [30, 30],
            iconAnchor: [15, 30]
        });
    };

    if (loading) return <div className="center-message">Loading dashboard...</div>;
    // This now correctly shows an error only when one truly occurs
    if (error) return <div className="center-message">{error}</div>;

    const decodedPolyline = route?.polyline ? polyline.decode(route.polyline) : [];

    return (
        <div className="driver-dashboard">
            <header className="driver-header">
                <h1>{route?.status === 'inactive' ? 'Awaiting Instructions' : 'Your Optimized Route'}</h1>
                <div className="route-summary">
                    <span><strong>Driver:</strong> {driver?.name || '...'}</span>
                    <span><strong>Total Time:</strong> {route?.totalDuration || 'N/A'}</span>
                    <span><strong>Total Distance:</strong> {route?.totalDistance || 'N/A'}</span>
                </div>
            </header>
            <div className="driver-main-content">
                <div className="driver-map-container">
                    <MapContainer ref={mapRef} center={WAREHOUSE_COORDS} zoom={12}>
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        <Marker position={WAREHOUSE_COORDS} icon={createNumberedIcon('W')}><Popup>Main Warehouse</Popup></Marker>
                        
                        {driver?.currentLocation?.coordinates && (
                            <Marker position={[driver.currentLocation.coordinates[1], driver.currentLocation.coordinates[0]]} icon={truckIcon}>
                                <Popup>Your current location</Popup>
                            </Marker>
                        )}
                        
                        {route?.stops?.map((stop, index) => (
                             <Marker key={stop._id} position={[stop.pickupLocation.coordinates[1], stop.pickupLocation.coordinates[0]]} icon={createNumberedIcon(index + 1)}>
                                 <Popup><b>Stop {index + 1}</b><br/>Delivery #{stop._id.slice(-6)}</Popup>
                             </Marker>
                        ))}
                        
                        {decodedPolyline.length > 0 && <Polyline positions={decodedPolyline} color="#007bff" weight={6} />}
                    </MapContainer>
                </div>
                <div className="driver-stops-panel">
                    <h2>Delivery Stops</h2>
                    <div className="stops-list">
                        {route?.stops?.length > 0 ? (
                            route.stops.map((stop, index) => (
                                <div key={stop._id} className={`stop-card ${stop.status}`}>
                                    <h3>Stop {index + 1}: Delivery #{stop._id.slice(-6)}</h3>
                                    <p><strong>ETA:</strong> {route.legs?.[index]?.duration || 'N/A'}</p>
                                    <p><strong>Status:</strong> {stop.status.replace('_', ' ').toUpperCase()}</p>
                                    <div className="stop-actions">
                                        <button className="goto-btn" onClick={() => handleGoToDelivery(stop)}>Show on Map</button>
                                        {stop.status === 'assigned' && <button onClick={() => handleStatusUpdate(stop._id, 'in_transit')}>Start Driving</button>}
                                        {stop.status === 'in_transit' && <button onClick={() => handleStatusUpdate(stop._id, 'delivered')}>Mark Delivered</button>}
                                        {stop.status === 'delivered' && <p className="completed-text">✓ Completed</p>}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="center-message">No deliveries currently assigned.</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default DriverDashboard;
