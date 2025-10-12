import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import './App.css';
import polyline from '@mapbox/polyline';

// --- ICONS & CONSTANTS ---
const truckIcon = new L.Icon({
    iconUrl: 'https://img.icons8.com/plasticine/100/000000/truck.png',
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
});
const warehouseIcon = new L.Icon({
    iconUrl: 'https://img.icons8.com/officel/80/000000/warehouse.png',
    iconSize: [45, 45],
    iconAnchor: [22, 44],
    popupAnchor: [0, -45]
});
const BACKEND_URL = "http://localhost:5001";
const socket = io(BACKEND_URL);
const WAREHOUSE_COORDS = [13.0827, 80.2707]; // Chennai
const createDeliveryIcon = (status) => {
    let color = {'pending':'#007bff','assigned':'#007bff','in_transit':'#ffc107','delivered':'#28a745','failed':'#dc3545'}[status];
    return L.divIcon({ html: `<div class="delivery-marker" style="background-color: ${color};"></div>`, className: '', iconSize: [16, 16], iconAnchor: [8, 8] });
};

// --- MODAL COMPONENTS ---
const modalStyles = {
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
    modal: { background: 'white', padding: '20px', borderRadius: '8px', width: '450px', maxWidth: '90%', position: 'relative', boxShadow: '0 5px 15px rgba(0,0,0,0.3)' },
    closeButton: { position: 'absolute', top: '10px', right: '10px', background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer' },
};

// This modal is for viewing details of a driver clicked on the map.
const DriverDetailModal = ({ driverId, onClose }) => {
    const [details, setDetails] = useState(null);
    useEffect(() => {
        if (driverId) {
            axios.get(`${BACKEND_URL}/api/drivers/${driverId}/details`)
                 .then(res => setDetails(res.data))
                 .catch(err => console.error("Error fetching driver details:", err));
        }
    }, [driverId]);
    if (!driverId) return null;
    return (
        <div style={modalStyles.overlay} onClick={onClose}>
            <div style={modalStyles.modal} onClick={e => e.stopPropagation()}>
                <button style={modalStyles.closeButton} onClick={onClose}>&times;</button>
                {!details ? <p>Loading details...</p> : (
                    <div>
                        <h2>{details.driver.name}</h2>
                        <p><strong>Status:</strong> {details.driver.isAvailable ? 'Available' : 'On Route'}</p>
                        <hr/>
                        <h3>Active Route</h3>
                        {details.activeRoute?.stops.length > 0 ? (
                            <ul>{details.activeRoute.stops.map(stop => <li key={stop._id}>Delivery #{stop._id.slice(-6)} - {stop.status}</li>)}</ul>
                        ) : <p>No active route assigned.</p>}
                    </div>
                )}
            </div>
        </div>
    );
};

// The Warehouse Modal now triggers the assignment process.
const WarehouseDetailModal = ({ isOpen, onClose, onSelectDriver }) => {
    const [stats, setStats] = useState(null);
    useEffect(() => {
        if (isOpen) {
            axios.get(`${BACKEND_URL}/api/dashboard/stats`).then(res => setStats(res.data));
        }
    }, [isOpen]);
    if (!isOpen) return null;
    return (
        <div style={modalStyles.overlay} onClick={onClose}>
            <div style={modalStyles.modal} onClick={e => e.stopPropagation()}>
                <button style={modalStyles.closeButton} onClick={onClose}>&times;</button>
                <h2>Warehouse Status</h2>
                {!stats ? <p>Loading stats...</p> : (
                    <div>
                        <h3>Inventory Summary</h3>
                        <p><strong>Pending:</strong> {stats.deliveryStats.pending || 0}</p>
                        <p><strong>In Transit:</strong> {stats.deliveryStats.in_transit || 0}</p>
                        <p><strong>Delivered:</strong> {stats.deliveryStats.delivered || 0}</p>
                        <hr />
                        <h3>Driver Status</h3>
                        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                            <div>
                                <h4>Available ({stats.availableDrivers.length})</h4>
                                <ul style={{listStyle:'none', padding: 0}}>{stats.availableDrivers.map(driver => (
                                    <li key={driver._id}>
                                        <button className="link-button" onClick={() => onSelectDriver(driver)}>
                                            Assign Task to {driver.name}
                                        </button>
                                    </li>
                                ))}</ul>
                            </div>
                            <div>
                                <h4>On Route ({stats.busyDrivers.length})</h4>
                                <ul style={{listStyle:'none', padding: 0}}>{stats.busyDrivers.map(d => <li key={d._id}>{d.name}</li>)}</ul>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// A dedicated modal for the second step of assignment.
const AssignDeliveryModal = ({ driver, pendingDeliveries, onClose, onAssign }) => {
    if (!driver) return null;
    return (
        <div style={modalStyles.overlay} onClick={onClose}>
            <div style={modalStyles.modal} onClick={e => e.stopPropagation()}>
                <button style={modalStyles.closeButton} onClick={onClose}>&times;</button>
                <h3>Assign Delivery to {driver.name}</h3>
                {pendingDeliveries.length > 0 ? (
                    <ul style={{ maxHeight: '200px', overflowY: 'auto', listStyle: 'none', padding: 0 }}>
                        {pendingDeliveries.map(delivery => (
                            <li key={delivery._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #eee' }}>
                                <span>Delivery #{delivery._id.slice(-6)}</span>
                                <button onClick={() => onAssign(driver._id, delivery._id)}>Assign</button>
                            </li>
                        ))}
                    </ul>
                ) : <p>No pending deliveries available.</p>}
            </div>
        </div>
    );
};

function AddDeliveryMarker({ onLocationSelect }) {
    useMapEvents({ click(e) { onLocationSelect(e.latlng); } });
    return null;
}

// --- MAIN ADMIN DASHBOARD COMPONENT ---
function AdminDashboard() {
    const [drivers, setDrivers] = useState([]);
    const [deliveries, setDeliveries] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [selectedDriver, setSelectedDriver] = useState(null);
    const [isWarehouseModalOpen, setWarehouseModalOpen] = useState(false);
    const [isAddingDelivery, setIsAddingDelivery] = useState(false);
    const [newDeliveryLocation, setNewDeliveryLocation] = useState(null);
    const [driverToAssign, setDriverToAssign] = useState(null);
    const mapRef = useRef();

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [driversRes, deliveriesRes, routesRes] = await Promise.all([
                    axios.get(`${BACKEND_URL}/api/drivers`),
                    axios.get(`${BACKEND_URL}/api/deliveries`),
                    axios.get(`${BACKEND_URL}/api/routes`)
                ]);
                setDrivers(driversRes.data);
                setDeliveries(deliveriesRes.data);
                setRoutes(routesRes.data);
            } catch (error) {
                console.error("Error fetching initial data:", error);
            }
        };

        fetchData();
        const handleUpdate = () => fetchData();
        socket.on('scheduleUpdated', handleUpdate);
        socket.on('driverLocationUpdated', handleUpdate);
        socket.on('deliveryStatusUpdated', handleUpdate);
        return () => {
            socket.off('scheduleUpdated', handleUpdate);
            socket.off('driverLocationUpdated', handleUpdate);
            socket.off('deliveryStatusUpdated', handleUpdate);
        };
    }, []);

    const handleAssignDelivery = async (driverId, deliveryId) => {
        try {
            await axios.post(`${BACKEND_URL}/api/routes/add-stop`, { driverId, deliveryId });
            alert('Delivery assigned successfully!');
            setDriverToAssign(null);
        } catch (error) {
            alert('Failed to assign delivery.');
        }
    };

    const handleSaveDelivery = async () => {
        if (!newDeliveryLocation) return;
        const payload = {
            pickupLocation: { type: "Point", coordinates: [newDeliveryLocation.lng, newDeliveryLocation.lat] },
            dropoffLocation: { type: "Point", coordinates: [newDeliveryLocation.lng, newDeliveryLocation.lat] }
        };
        try {
            await axios.post(`${BACKEND_URL}/api/deliveries`, payload);
            alert('Delivery created successfully!');
            setIsAddingDelivery(false);
            setNewDeliveryLocation(null);
        } catch (error) {
            alert('Failed to create delivery.');
        }
    };
    
    const handleFocusOnDriver = (driver) => {
        const { current: map } = mapRef;
        if (map && driver.currentLocation?.coordinates) {
            const coords = [driver.currentLocation.coordinates[1], driver.currentLocation.coordinates[0]];
            map.setView(coords, 14, { animate: true });
        }
    };

    const pendingDeliveries = deliveries.filter(d => d.status === 'pending');

    return (
        <div className="dashboard">
            <DriverDetailModal 
                driverId={selectedDriver} 
                onClose={() => setSelectedDriver(null)}
            />
            <WarehouseDetailModal 
                isOpen={isWarehouseModalOpen} 
                onClose={() => setWarehouseModalOpen(false)}
                onSelectDriver={(driver) => {
                    setWarehouseModalOpen(false);
                    setDriverToAssign(driver);
                }}
            />
            <AssignDeliveryModal
                driver={driverToAssign}
                pendingDeliveries={pendingDeliveries}
                onClose={() => setDriverToAssign(null)}
                onAssign={handleAssignDelivery}
            />

            <header><h1>Real-Time Parcel Distribution Dashboard</h1></header>
            <div className="main-content">
                <div className="data-panels">
                    <div className="panel">
                        <h3>Actions</h3>
                        <button onClick={() => axios.post(`${BACKEND_URL}/api/schedule`)}>Generate Schedule</button>
                        <button onClick={() => { setIsAddingDelivery(!isAddingDelivery); setNewDeliveryLocation(null); }} style={{ marginTop: '10px' }}>
                            {isAddingDelivery ? 'Cancel Adding' : 'Add New Delivery'}
                        </button>
                        <button onClick={() => setWarehouseModalOpen(true)} style={{ marginTop: '10px' }}>
                            Warehouse Status
                        </button>
                        {isAddingDelivery && (
                            <div style={{marginTop: '15px'}}>
                                <p>Click map to set a location.</p>
                                {newDeliveryLocation && <button onClick={handleSaveDelivery}>Save Delivery</button>}
                            </div>
                        )}
                    </div>
                    <div className="panel">
                        <h3>Drivers ({drivers.length})</h3>
                        <ul>{drivers.map(driver => ( <li key={driver._id}><button className="link-button" onClick={() => handleFocusOnDriver(driver)}><strong>{driver.name}</strong></button> - {driver.isAvailable ? 'Available' : 'On Route'}</li> ))}</ul>
                    </div>
                    <div className="panel">
                        <h3>Deliveries ({deliveries.length})</h3>
                        <ul>{deliveries.map(delivery => ( <li key={delivery._id}>ID: ...{delivery._id.slice(-6)} - <strong>{delivery.status}</strong></li> ))}</ul>
                    </div>
                </div>
                <div className="map-container">
                    <MapContainer ref={mapRef} center={WAREHOUSE_COORDS} zoom={12}>
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        {isAddingDelivery && <AddDeliveryMarker onLocationSelect={setNewDeliveryLocation} />}
                        {newDeliveryLocation && <Marker position={newDeliveryLocation}><Popup>New delivery location</Popup></Marker>}
                        
                        <Marker position={WAREHOUSE_COORDS} icon={warehouseIcon} eventHandlers={{ click: () => setWarehouseModalOpen(true) }}><Popup><b>Main Warehouse</b></Popup></Marker>
                        
                        {drivers.map(driver => driver.currentLocation?.coordinates && (
                            <Marker key={driver._id} position={[driver.currentLocation.coordinates[1], driver.currentLocation.coordinates[0]]} icon={truckIcon} eventHandlers={{ click: () => setSelectedDriver(driver._id) }}><Popup><b>{driver.name}</b></Popup></Marker>
                        ))}
                        {deliveries.map(delivery => (
                            <Marker key={delivery._id} position={[delivery.pickupLocation.coordinates[1], delivery.pickupLocation.coordinates[0]]} icon={createDeliveryIcon(delivery.status)}><Popup><b>Delivery ...{delivery._id.slice(-6)}</b><br />Status: {delivery.status}</Popup></Marker>
                        ))}
                        {routes.map(route => route.polyline && <Polyline key={route._id} positions={polyline.decode(route.polyline)} color="#0d6efd" weight={5} />)}
                    </MapContainer>
                </div>
            </div>
        </div>
    );
}

export default AdminDashboard;

