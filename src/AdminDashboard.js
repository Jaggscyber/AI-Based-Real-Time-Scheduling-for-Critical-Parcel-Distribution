import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import './App.css';
import polyline from '@mapbox/polyline';

const BACKEND_URL = "http://localhost:5001";
const socket = io(BACKEND_URL, { transports: ['websocket'] });
const WAREHOUSE_COORDS = [13.0827, 80.2707];

const createDriverIcon = (driverName) => {
    const initial = driverName ? driverName.charAt(0).toUpperCase() : '?';
    return L.divIcon({ html: `<div class="driver-icon-container"><img src="https://img.icons8.com/plasticine/100/000000/truck.png" class="driver-truck-img"/><span class="driver-initial">${initial}</span></div>`, className: 'driver-icon', iconSize: [40, 40], iconAnchor: [20, 40], popupAnchor: [0, -40] });
};
const warehouseIcon = new L.Icon({ iconUrl: 'https://img.icons8.com/officel/80/000000/warehouse.png', iconSize: [45, 45], iconAnchor: [22, 44], popupAnchor: [0, -45] });
const newDeliveryIcon = L.divIcon({ html: `<div class="delivery-marker" style="background-color: #FA5252;"></div>`, className: 'new-delivery-icon-wrapper', iconSize: [20, 20], iconAnchor: [10, 10] });
const createDeliveryIcon = (status) => {
    let color = {'pending':'#007bff','assigned':'#007bff','in_transit':'#ffc107','delivered':'#28a745','failed':'#dc3545'}[status];
    return L.divIcon({ html: `<div class="delivery-marker" style="background-color: ${color};"></div>`, className: '', iconSize: [16, 16], iconAnchor: [8, 8] });
};

const modalStyles = {
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1050 },
    modal: { background: 'white', padding: '20px', borderRadius: '8px', width: '450px', maxWidth: '90%', position: 'relative', boxShadow: '0 5px 15px rgba(0,0,0,0.3)' },
    closeButton: { position: 'absolute', top: '10px', right: '10px', background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer' },
};

const DriverDetailPane = ({ driverId, onClose }) => {
    const [details, setDetails] = useState(null);
    useEffect(() => { if (driverId) { setDetails(null); axios.get(`${BACKEND_URL}/api/drivers/${driverId}/details`).then(res => setDetails(res.data)); } }, [driverId]);
    return (<div className={`driver-detail-pane ${driverId ? 'open' : ''}`}><button onClick={onClose} className="close-pane-btn">&times;</button>{!details ? <p className="loading-text">Loading details...</p> : (<div><h2>{details.driver.name}</h2><p><strong>Status:</strong> {details.driver.isAvailable ? 'Available' : 'On Route'}</p><div className="delivery-counts"><h4>Route Progress</h4><p>Assigned: {details.deliveryStatusCounts.assigned}</p><p>In Transit: {details.deliveryStatusCounts.in_transit}</p><p>Delivered: {details.deliveryStatusCounts.delivered}</p></div><hr/><h3>Stop List</h3>{details.activeRoute?.stops.length > 0 ? (<ul>{details.activeRoute.stops.map(stop => (<li key={stop._id}>Delivery #{stop._id.slice(-6)} - <strong>{stop.status.toUpperCase()}</strong></li>))}</ul>) : <p>No active route assigned.</p>}</div>)}</div>);
};

const WarehouseDetailModal = ({ isOpen, onClose, deliveries }) => {
    const [activeTab, setActiveTab] = useState('status');
    const [history, setHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    useEffect(() => { if (isOpen && activeTab === 'history') { setLoadingHistory(true); axios.get(`${BACKEND_URL}/api/deliveries/history`).then(res => setHistory(res.data)).finally(() => setLoadingHistory(false)); } }, [isOpen, activeTab]);
    if (!isOpen) return null;
    const pendingCount = deliveries.filter(d => d.status === 'pending').length;
    const activeCount = deliveries.filter(d => ['assigned', 'in_transit'].includes(d.status)).length;
    return (<div style={modalStyles.overlay} onClick={onClose}><div style={{...modalStyles.modal, width: '800px', maxWidth: '90%'}} onClick={e => e.stopPropagation()}><button style={modalStyles.closeButton} onClick={onClose}>&times;</button><h2>Warehouse Logistics</h2><div className="modal-tabs"><button onClick={() => setActiveTab('status')} className={activeTab === 'status' ? 'active' : ''}>Current Status</button><button onClick={() => setActiveTab('history')} className={activeTab === 'history' ? 'active' : ''}>Delivery History</button></div>{activeTab === 'status' && (<div><h3>Inventory Overview</h3><p><strong>Pending Assignment:</strong> {pendingCount}</p><p><strong>Active (On Route):</strong> {activeCount}</p></div>)}{activeTab === 'history' && (<div className="history-modal-content">{loadingHistory ? <p>Loading history...</p> : (<table className="history-table"><thead><tr><th>ID</th><th>Driver</th><th>Status</th><th>Completed At</th></tr></thead><tbody>{history.map(item => (<tr key={item._id}><td>...{item._id.slice(-6)}</td><td>{item.assignedDriver?.name || 'N/A'}</td><td>{item.status.toUpperCase()}</td><td>{new Date(item.completedAt).toLocaleString()}</td></tr>))}</tbody></table>)}</div>)}</div></div>);
};

const Notification = ({ message, onDismiss }) => {
    useEffect(() => { if (message) { const timer = setTimeout(() => onDismiss(), 5000); return () => clearTimeout(timer); } }, [message, onDismiss]);
    if (!message) return null;
    return ( <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 2000, background: 'rgba(40, 167, 69, 0.9)', color: 'white', padding: '15px', borderRadius: '8px', boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }}><p style={{margin: 0}}>{message}</p><button onClick={onDismiss} style={{background: 'none', border: 'none', color: 'white', position: 'absolute', top: '5px', right: '10px', fontSize: '1.2rem'}}>&times;</button></div> );
};

function AddDeliveryMarker({ onLocationSelect }) { useMapEvents({ click(e) { onLocationSelect(e.latlng); } }); return null; }

function AdminDashboard() {
    const [drivers, setDrivers] = useState([]);
    const [deliveries, setDeliveries] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [selectedDriver, setSelectedDriver] = useState(null);
    const [isWarehouseModalOpen, setWarehouseModalOpen] = useState(false);
    const [isAddingDelivery, setIsAddingDelivery] = useState(false);
    const [newDeliveryLocation, setNewDeliveryLocation] = useState(null);
    const [notification, setNotification] = useState('');
    const [appStatus, setAppStatus] = useState('loading');
    const mapRef = useRef();

    const fetchData = useCallback(async () => {
        try { const [driversRes, deliveriesRes, routesRes] = await Promise.all([ axios.get(`${BACKEND_URL}/api/drivers`), axios.get(`${BACKEND_URL}/api/deliveries`), axios.get(`${BACKEND_URL}/api/routes`) ]); setDrivers(driversRes.data || []); setDeliveries(deliveriesRes.data || []); setRoutes(routesRes.data || []); } catch (error) { console.error(error); } finally { setAppStatus('ready'); }
    }, []);

    useEffect(() => {
        fetchData();
        const handleUpdate = (data) => { if (data && data.message) setNotification(data.message); fetchData(); };
        socket.on('scheduleUpdated', handleUpdate);
        socket.on('driverLocationUpdated', (driverData) => setDrivers(prev => prev.map(d => d._id === driverData._id ? driverData : d)));
        return () => { socket.off('scheduleUpdated', handleUpdate); socket.off('driverLocationUpdated'); };
    }, [fetchData]);

    const handleGenerateSchedule = async () => {
        setAppStatus('generating');
        try {
            const res = await axios.post(`${BACKEND_URL}/api/schedule`);
            setNotification(res.data.message || 'Schedule generation initiated!');
        } catch (error) {
            setNotification(error.response?.data?.message || "AI could not generate routes.");
        } finally {
            setAppStatus('ready');
        }
    };

    const handleSaveDelivery = async () => {
        if (!newDeliveryLocation) return;
        try {
            await axios.post(`${BACKEND_URL}/api/deliveries`, { 
                pickupLocation: { type: "Point", coordinates: [newDeliveryLocation.lng, newDeliveryLocation.lat] },
                dropoffLocation: { type: "Point", coordinates: [newDeliveryLocation.lng, newDeliveryLocation.lat] } 
            });
            setNotification('Delivery created successfully!');
            setIsAddingDelivery(false);
            setNewDeliveryLocation(null);
            // fetchData will be called by socket event
        } catch (error) {
            setNotification('Error: Failed to create delivery.');
        }
    };
    
    const handleDriverSelect = (driverId) => { setSelectedDriver(driverId); };
    const clearFocus = () => { setSelectedDriver(null); };
    
    const handleResetAll = async () => {
        if (window.confirm('Are you sure you want to reset all drivers, routes, and active deliveries?')) {
            try {
                const res = await axios.post(`${BACKEND_URL}/api/drivers/reset-all`);
                setNotification(res.data.msg || 'All drivers have been reset.');
            } catch (error) {
                setNotification('Error: Could not reset drivers.');
            }
        }
    };

    const handleDeleteDelivery = async (deliveryId) => {
        if (window.confirm('Are you sure you want to delete this delivery?')) {
            try {
                await axios.delete(`${BACKEND_URL}/api/deliveries/${deliveryId}`);
                setNotification('Delivery deleted successfully.');
            } catch (error) {
                setNotification(error.response?.data?.msg || 'Error deleting delivery.');
            }
        }
    };
    
    useEffect(() => {
        const { current: map } = mapRef;
        if (!map) return;
        if (!selectedDriver) { const allPoints = [WAREHOUSE_COORDS]; drivers.forEach(d => { if(d.currentLocation?.coordinates) allPoints.push([d.currentLocation.coordinates[1], d.currentLocation.coordinates[0]]) }); if (allPoints.length > 1) { map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] }); } else { map.setView(WAREHOUSE_COORDS, 12); } }
        else { const driverRoute = routes.find(r => r.driver && r.driver._id === selectedDriver); const driver = drivers.find(d => d._id === selectedDriver); if (!driver) return; let allPoints = []; if (driver.currentLocation?.coordinates) allPoints.push([driver.currentLocation.coordinates[1], driver.currentLocation.coordinates[0]]); if (driverRoute) allPoints.push(...driverRoute.stops.map(s => [s.pickupLocation.coordinates[1], s.pickupLocation.coordinates[0]])); if (allPoints.length > 0) { map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50], maxZoom: 15 }); } }
    }, [selectedDriver, routes, drivers]);

    const displayedDeliveries = selectedDriver ? deliveries.filter(d => routes.some(r => r.driver?._id === selectedDriver && r.stops.some(stop => stop._id === d._id))) : deliveries;
    
    return (
        <div className="dashboard">
            <WarehouseDetailModal isOpen={isWarehouseModalOpen} onClose={() => setWarehouseModalOpen(false)} deliveries={deliveries} />
            <Notification message={notification} onDismiss={() => setNotification('')} />
            <header><h1>Real-Time Parcel Distribution Dashboard</h1></header>
            <div className="main-content">
                <div className="data-panels">
                    <div className="panel">
                        <h3>Actions</h3>
                        <button onClick={handleGenerateSchedule} disabled={appStatus !== 'ready'}>Generate Schedule</button>
                        <button onClick={clearFocus} style={{ marginLeft: '10px' }}>Show All Routes</button>
                        <hr style={{margin: '15px 0'}}/>
                        <button onClick={() => { setIsAddingDelivery(!isAddingDelivery); setNewDeliveryLocation(null); }}>{isAddingDelivery ? 'Cancel' : 'Add New Delivery'}</button>
                        <button onClick={() => setWarehouseModalOpen(true)} style={{ marginLeft: '10px' }}>Warehouse Status</button>
                        {isAddingDelivery && ( <div style={{marginTop: '15px'}}><p>Click map.</p>{newDeliveryLocation && <button onClick={handleSaveDelivery}>Save</button>}</div>)}
                        <button onClick={handleResetAll} style={{ backgroundColor: '#dc3545', color: 'white', marginTop: '10px', width: '100%' }}>Reset All Drivers</button>
                    </div>
                    <div className="panel">
                        <h3>Drivers ({drivers.length})</h3>
                        {appStatus === 'loading' ? <p>Loading...</p> : <ul>{drivers.map(driver => ( <li key={driver._id}><button className="link-button" onClick={() => handleDriverSelect(driver._id)}><strong>{driver.name}</strong></button> - {driver.isAvailable ? 'Available' : 'On Route'}</li> ))}</ul>}
                    </div>
                    <div className="panel">
                        <h3>Active Deliveries ({displayedDeliveries.length})</h3>
                        {appStatus === 'loading' ? <p>Loading...</p> : <ul style={{maxHeight: '200px', overflowY: 'auto'}}>{displayedDeliveries.map(delivery => ( <li key={delivery._id}>ID: ...{delivery._id.slice(-6)} - <strong>{delivery.status.toUpperCase()}</strong></li> ))}</ul>}
                    </div>
                </div>
                <div className="map-container">
                    <MapContainer ref={mapRef} center={WAREHOUSE_COORDS} zoom={12}>
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        <Marker position={WAREHOUSE_COORDS} icon={warehouseIcon}><Popup><b>Main Warehouse</b></Popup></Marker>
                        {isAddingDelivery && <AddDeliveryMarker onLocationSelect={setNewDeliveryLocation} />}
                        {newDeliveryLocation && <Marker position={newDeliveryLocation} icon={newDeliveryIcon}><Popup>New delivery location.</Popup></Marker>}
                        {drivers.map(driver => driver.currentLocation?.coordinates && (<Marker key={driver._id} position={[driver.currentLocation.coordinates[1], driver.currentLocation.coordinates[0]]} icon={createDriverIcon(driver.name)} eventHandlers={{ click: () => handleDriverSelect(driver._id) }}><Popup><b>{driver.name}</b></Popup></Marker>))}
                        {displayedDeliveries.map(delivery => (<Marker key={delivery._id} position={[delivery.pickupLocation.coordinates[1], delivery.pickupLocation.coordinates[0]]} icon={createDeliveryIcon(delivery.status)}><Popup><div className="popup-content"><p><strong>ID:</strong>...{delivery._id.slice(-6)}</p><p><strong>Status:</strong> {delivery.status.toUpperCase()}</p><p><strong>Created:</strong> {new Date(delivery.createdAt).toLocaleTimeString()}</p><button className="popup-delete-btn" onClick={() => handleDeleteDelivery(delivery._id)}>Delete</button></div></Popup></Marker>))}
                        {routes.filter(r => !selectedDriver || (r.driver && r.driver._id === selectedDriver)).map(route => route.polyline && <Polyline key={route._id} positions={polyline.decode(route.polyline)} color="#0d6efd" weight={5} />)}
                    </MapContainer>
                </div>
                <DriverDetailPane driverId={selectedDriver} onClose={clearFocus} />
            </div>
        </div>
    );
}

export default AdminDashboard;