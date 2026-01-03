import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, useMap, Circle } from 'react-leaflet';
import L from 'leaflet';
import './App.css';
import polyline from '@mapbox/polyline';

// --- Configuration ---
const BACKEND_URL = "http://localhost:5000"; 
const AI_SERVICE_URL = "http://localhost:5001"; 
const socket = io(BACKEND_URL, { transports: ['websocket'] });
const WAREHOUSE_COORDS = [13.0827, 80.2707];

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
const MapRecenter = ({ center, zoom }) => {
    const map = useMap();
    useEffect(() => {
        if (center) {
            map.flyTo(center, zoom || 13, { duration: 1.5 });
        }
    }, [center, zoom, map]);
    return null;
};

// 2. UNIFIED MAP CLICK HANDLER (Handles Traffic Blocks & Delivery Drops)
function MapClickHandler({ isBlockMode, isAddingDelivery, onBlockAdd, onDeliveryAdd }) {
    useMapEvents({
        click(e) {
            if (isBlockMode) {
                onBlockAdd(e.latlng);
            } else if (isAddingDelivery) {
                onDeliveryAdd(e.latlng);
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
                    <div style={{padding:'20px'}}>
                        <div style={{display:'flex', gap:'20px'}}>
                            <div className="panel" style={{flex:1, textAlign:'center'}}>
                                <h3>Pending Processing</h3>
                                <h1 style={{color:'#f39c12'}}>{pendingCount}</h1>
                            </div>
                            <div className="panel" style={{flex:1, textAlign:'center'}}>
                                <h3>Out for Delivery</h3>
                                <h1 style={{color:'#3498db'}}>{activeCount}</h1>
                            </div>
                        </div>
                    </div>
                )}
                {activeTab === 'history' && (
                    <div className="history-modal-content">
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
    const [zone, setZone] = useState('Unzoned');
    const [weight, setWeight] = useState(5);
    const [deadline, setDeadline] = useState(480);

    if (!isOpen) return null;

    const handleSave = () => {
        if (!customerName || !mapLocation) { alert('Name and Location required'); return; }
        onSave({ customerName, customerPhone, zone, weight, deadline });
        setCustomerName(''); setCustomerPhone(''); setZone('Unzoned'); setWeight(5); setDeadline(480);
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <button onClick={onClose} className="close-modal-btn">&times;</button>
                <h2>Add New Delivery</h2>
                <p className="help-text">Location: {mapLocation ? `${mapLocation.lat.toFixed(4)}, ${mapLocation.lng.toFixed(4)}` : 'None'}</p>
                
                <div style={{display:'flex', flexDirection:'column', gap:'10px'}}>
                    <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Customer Name" />
                    <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="Phone Number" />
                    <input value={zone} onChange={e => setZone(e.target.value)} placeholder="Zone (Optional)" />
                    
                    <div style={{display:'flex', gap:'10px'}}>
                        <div style={{flex:1}}>
                            <label style={{fontSize:'0.85rem', fontWeight:'bold'}}>Weight (kg)</label>
                            <input type="number" value={weight} onChange={e => setWeight(Number(e.target.value))} />
                        </div>
                        <div style={{flex:1}}>
                            <label style={{fontSize:'0.85rem', fontWeight:'bold'}}>Deadline (mins)</label>
                            <input type="number" value={deadline} onChange={e => setDeadline(Number(e.target.value))} />
                        </div>
                    </div>
                </div>

                <div className="modal-actions">
                    <button onClick={handleSave} style={{background:'#28a745'}}>Create Order</button>
                    <button onClick={onClose} className="cancel-btn" style={{background:'#6c757d'}}>Cancel</button>
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
    const [mapCenter, setMapCenter] = useState(WAREHOUSE_COORDS);
    
    // --- New Comparison / Traffic States ---
    const [comparisonData, setComparisonData] = useState(null);
    const [isTrafficMode, setIsTrafficMode] = useState(false); // NEW: Controls the red button
    const [blockages, setBlockages] = useState([]); // NEW: Stores the Red Circles
    
    // UI States
    const [isAddingDelivery, setIsAddingDelivery] = useState(false);
    const [newDeliveryLocation, setNewDeliveryLocation] = useState(null);
    const [isDeliveryModalOpen, setDeliveryModalOpen] = useState(false);
    const [isWarehouseModalOpen, setWarehouseModalOpen] = useState(false);
    const [algorithm, setAlgorithm] = useState('gmaps-tsp');
    const [notification, setNotification] = useState({ msg: '', isError: false });
    const [appStatus, setAppStatus] = useState('ready');

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

    useEffect(() => {
        fetchData();
        socket.on('scheduleUpdated', (data) => {
            if (data?.message) setNotification({ msg: data.message, isError: false });
            fetchData();
        });
        socket.on('driverLocationUpdated', (dData) => {
            setDrivers(prev => prev.map(d => d._id === dData._id ? dData : d));
        });
        return () => { socket.off('scheduleUpdated'); socket.off('driverLocationUpdated'); };
    }, [fetchData]);

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

    const handleResetAll = async () => {
        if (window.confirm('⚠ Emergency Reset: This will clear all routes and return drivers to warehouse. Continue?')) {
            await axios.post(`${BACKEND_URL}/api/drivers/reset-all`);
            setNotification({ msg: 'System Reset Complete.', isError: false });
            setRoutes([]);
            setComparisonData(null);
            setBlockages([]); // Clear traffic on reset
            fetchData();
        }
    };

    const handleDeleteDelivery = async (id) => {
        if(window.confirm("Delete this delivery?")) {
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
        setIsTrafficMode(!isTrafficMode);
        setIsAddingDelivery(false); // Ensure we don't do both at once
        setComparisonData(null);
        if(!isTrafficMode) {
            setNotification({ msg: "🚧 TRAFFIC MODE: Click map to block roads.", isError: false });
        }
    };

    // 2. Handle Map Click for Blockage
    const handleBlockMapClick = (latlng) => {
        setBlockages([...blockages, latlng]);
        setNotification({ msg: "Road Blocked! 🛑 Click 'Generate' to reroute.", isError: false });
    };

    // 3. Comparison Mode
    const handleCompare = async () => {
        setNotification({ msg: "Running Comparison Analysis...", isError: false });
        try {
            const activeDrivers = drivers.filter(d => !d.isAvailable); 
            const assignedDeliveries = deliveries.filter(d => d.status === 'assigned');

            if(assignedDeliveries.length === 0) {
                setNotification({ msg: "Assign deliveries first before comparing.", isError: true });
                return;
            }
            
            const blockageArray = blockages.map(b => [b.lat, b.lng]);

            const res = await axios.post(`${AI_SERVICE_URL}/compare`, {
                drivers: activeDrivers.length > 0 ? activeDrivers : drivers, 
                deliveries: assignedDeliveries,
                blockages: blockageArray
            });
            
            setComparisonData(res.data);
            setNotification({ msg: "Comparison Complete!", isError: false });
        } catch (err) { 
            console.error(err);
            setNotification({ msg: "Comparison Failed. Ensure AI service is running.", isError: true });
        }
    };

    // Filter Logic
    const filteredDrivers = selectedDriver ? drivers.filter(d => d._id === selectedDriver) : drivers;
    const filteredRoutes = selectedDriver ? routes.filter(r => r.driverId === selectedDriver || r.driver?._id === selectedDriver) : routes;
    const filteredDeliveries = selectedDriver 
        ? deliveries.filter(d => d.assignedDriver === selectedDriver || d.assignedDriver?._id === selectedDriver) 
        : deliveries;

    // Metrics
    const totalRevenue = deliveries.reduce((acc, d) => acc + (d.cost || 50), 0);
    const completedCount = deliveries.filter(d => d.status === 'delivered').length;
    const activeTrucks = drivers.filter(d => !d.isAvailable && d.vehicleType === 'Truck').length;
    const activeBikes = drivers.filter(d => !d.isAvailable && d.vehicleType === 'Bike').length;

    return (
        <div className="dashboard" style={{ flexDirection: 'row' }}>
            {/* Sidebar Navigation */}
            <div style={{ width: '250px', background: '#2c3e50', color: 'white', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '20px', background: '#1a252f', textAlign:'center' }}>
                    <h3 style={{margin:0}}>Admin Panel</h3>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {['dashboard', 'map', 'drivers', 'deliveries'].map(view => (
                        <li key={view} 
                            style={{ padding: '15px 20px', borderBottom: '1px solid #34495e', cursor: 'pointer', background: activeView === view ? '#3498db' : 'transparent', fontWeight: activeView===view?'bold':'normal' }} 
                            onClick={() => { setActiveView(view); setSelectedDriver(null); }}>
                            {view.charAt(0).toUpperCase() + view.slice(1)}
                        </li>
                    ))}
                    <li style={{ padding: '15px 20px', borderBottom: '1px solid #34495e', cursor: 'pointer' }} onClick={() => setWarehouseModalOpen(true)}>
                        Warehouse Stats
                    </li>
                </ul>
                <div style={{ marginTop: 'auto', padding: '20px' }}>
                    <button onClick={handleResetAll} className="reset-button" style={{background:'#e74c3c'}}>⚠ System Reset</button>
                    <button onClick={() => window.location.href='/login'} style={{ marginTop: '10px', width: '100%', background:'#95a5a6', border:'none', padding:'10px', color:'white' }}>Logout</button>
                </div>
            </div>

            {/* Main Content */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
                <Notification message={notification.msg} isError={notification.isError} onDismiss={() => setNotification({ msg: '', isError: false })} />
                <AddDeliveryModal isOpen={isDeliveryModalOpen} onClose={() => setDeliveryModalOpen(false)} onSave={handleSaveDelivery} mapLocation={newDeliveryLocation} />
                <WarehouseDetailModal isOpen={isWarehouseModalOpen} onClose={() => setWarehouseModalOpen(false)} deliveries={deliveries} />

                <header style={{ padding: '1rem', background: 'white', borderBottom: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ margin: 0, color: '#2c3e50' }}>Parcel Distribution Control Center</h2>
                    <div style={{ fontSize: '0.9rem', color: '#555', fontWeight:'bold' }}>
                        🟢 System Online
                    </div>
                </header>

                <div style={{ padding: '20px', flex: 1, overflowY: 'auto', background: '#f4f7f6' }}>
                    
                    {/* VIEW: DASHBOARD */}
                    {activeView === 'dashboard' && (
                        <div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '30px' }}>
                                <div className="panel center-text"><h3>Total Orders</h3><h1>{deliveries.length}</h1></div>
                                <div className="panel center-text"><h3>Completed</h3><h1 style={{ color: '#28a745' }}>{completedCount}</h1></div>
                                <div className="panel center-text"><h3>Active Trucks</h3><h1>{activeTrucks}</h1></div>
                                <div className="panel center-text"><h3>Active Bikes</h3><h1>{activeBikes}</h1></div>
                                <div className="panel center-text"><h3>Revenue</h3><h1>₹{totalRevenue}</h1></div>
                            </div>
                            <div className="panel">
                                <h3>Quick Actions</h3>
                                <div style={{display:'flex', gap:'10px'}}>
                                    <button onClick={() => setActiveView('map')} style={{background:'#3498db'}}>View Live Map</button>
                                    <button onClick={() => setWarehouseModalOpen(true)} style={{background:'#8e44ad'}}>Check Inventory</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* VIEW: DELIVERIES */}
                    {activeView === 'deliveries' && (
                        <div className="panel">
                            <h3>Master Delivery Manifest</h3>
                            <table className="history-table">
                                <thead><tr><th>Customer</th><th>Zone</th><th>Weight</th><th>Deadline</th><th>Status</th><th>Driver</th><th>Action</th></tr></thead>
                                <tbody>
                                    {deliveries.map(d => (
                                        <tr key={d._id}>
                                            <td>
                                                <strong>{d.customerName}</strong><br/>
                                                <span style={{fontSize:'0.8rem', color:'#777'}}>{d.customerPhone}</span>
                                            </td>
                                            <td>{d.zone}</td>
                                            <td>{d.weight || 5} kg</td>
                                            <td>{d.deadline || 480} min</td>
                                            <td><span className={`badge ${d.status}`}>{d.status.toUpperCase()}</span></td>
                                            <td>{d.assignedDriver ? d.assignedDriver.name : "Unassigned"}</td>
                                            <td><button onClick={() => handleDeleteDelivery(d._id)} style={{background:'#e74c3c', padding:'5px 10px', fontSize:'0.8rem'}}>Delete</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* VIEW: DRIVERS */}
                    {activeView === 'drivers' && (
                        <div className="panel">
                            <h3>Driver Fleet Status</h3>
                            <table className="history-table">
                                <thead><tr><th>Name</th><th>Vehicle</th><th>Capacity</th><th>Range</th><th>Status</th><th>Zone</th><th>Action</th></tr></thead>
                                <tbody>
                                    {drivers.map(d => (
                                        <tr key={d._id}>
                                            <td style={{fontWeight:'bold'}}>{d.name}</td>
                                            <td>{d.vehicleType}</td>
                                            <td>{d.maxCapacity || 30} kg</td>
                                            <td>{d.maxRange || 100} km</td>
                                            <td>{d.isAvailable ? <span style={{color:'green'}}>● Available</span> : <span style={{color:'orange'}}>● On Route</span>}</td>
                                            <td>{d.assignedZone || 'Unzoned'}</td>
                                            <td>
                                                <button onClick={() => handleViewDriverOnMap(d._id)} style={{ background: '#3498db', padding:'5px 10px' }}>
                                                    Track on Map
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* VIEW: MAP */}
                    {activeView === 'map' && (
                        <div style={{ display: 'flex', gap: '20px', height: '100%' }}>
                            {/* Controls Side */}
                            <div className="panel" style={{ width: '300px', display: 'flex', flexDirection: 'column', height:'fit-content' }}>
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
                                    <div className="form-group">
                                        <label>Optimization Engine</label>
                                        <select value={algorithm} onChange={e => setAlgorithm(e.target.value)} style={{ width: '100%', padding: '8px' }}>
                                            <option value="gmaps-tsp">Google Maps (Standard)</option>
                                            <option value="aco">Ant Colony (Experimental)</option>
                                            <option value="genetic">Genetic AI (Capacity Aware)</option>
                                        </select>
                                    </div>
                                )}

                                {/* 2. ACTION BUTTONS */}
                                <button 
                                    onClick={handleGenerateSchedule} 
                                    disabled={appStatus !== 'ready'} 
                                    style={{ marginBottom: '15px', padding:'12px', fontSize:'1rem', background: appStatus === 'generating' ? '#f39c12' : '#28a745' }}>
                                    {appStatus === 'generating' ? 'AI is Optimizing...' : 'Generate AI Schedule'}
                                </button>
                                <p style={{fontSize:'0.8rem', textAlign:'center', marginTop:-10, marginBottom:10}}>
                                    Active Constraints: {blockages.length}
                                    {blockages.length > 0 && <span onClick={()=>setBlockages([])} style={{color:'red', cursor:'pointer', marginLeft:'5px'}}>(Clear)</span>}
                                </p>

                                {/* 3. NEW FEATURES: TRAFFIC & COMPARE */}
                                {!selectedDriver && (
                                    <div style={{ marginBottom: '15px', borderTop:'1px solid #eee', paddingTop:'15px' }}>
                                        <h4 style={{margin:'0 0 10px 0', fontSize:'0.9rem', color:'#555'}}>Advanced AI Tools</h4>
                                        
                                        <button 
                                            onClick={toggleTrafficMode} 
                                            style={{ background: isTrafficMode ? '#e74c3c' : '#f39c12', marginBottom: '10px', width: '100%' }}>
                                            {isTrafficMode ? 'DONE BLOCKING 🛑' : '🚦 Simulate Traffic Jam'}
                                        </button>

                                        <button 
                                            onClick={handleCompare} 
                                            style={{ background: '#8e44ad', width: '100%' }}>
                                            ⚖ Compare: Google vs AI
                                        </button>
                                    </div>
                                )}

                                {/* 4. COMPARISON WIDGET */}
                                {comparisonData && (
                                    <div style={{ marginBottom: '15px', padding: '10px', background: '#f8f9fa', border: '1px solid #ddd', fontSize:'0.85rem' }}>
                                        <h4 style={{margin:'0 0 10px 0'}}>Analysis Result</h4>
                                        <div style={{color: comparisonData.algo_1.color, marginBottom:'5px'}}>
                                            <strong>{comparisonData.algo_1.name}</strong><br/>
                                            {comparisonData.algo_1.duration} | {comparisonData.algo_1.distance}
                                        </div>
                                        <div style={{color: comparisonData.algo_2.color}}>
                                            <strong>{comparisonData.algo_2.name}</strong><br/>
                                            {comparisonData.algo_2.duration} | {comparisonData.algo_2.distance}
                                        </div>
                                        <div style={{marginTop:'8px', fontStyle:'italic', color:'#27ae60'}}>
                                            AI Efficiency: +{(parseInt(comparisonData.algo_1.duration) - parseInt(comparisonData.algo_2.duration))} mins saved.
                                        </div>
                                    </div>
                                )}
                                
                                <div style={{borderTop:'1px solid #eee', paddingTop:'15px'}}>
                                    <button onClick={() => setIsAddingDelivery(!isAddingDelivery)} style={{ background: isAddingDelivery ? '#e74c3c' : '#007bff', width:'100%' }}>
                                        {isAddingDelivery ? 'Cancel Adding' : '+ Drop Package on Map'}
                                    </button>
                                    {isAddingDelivery && <p className="help-text" style={{textAlign:'center'}}>Click on the map to place a delivery.</p>}
                                </div>
                            </div>

                            {/* Map Side */}
                            <div className="map-container" style={{ flex: 1, borderRadius: '8px', overflow: 'hidden', border: '1px solid #ccc', position:'relative' }}>
                                <MapContainer center={mapCenter} zoom={12} style={{ height: '100%' }}>
                                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                                    <MapRecenter center={mapCenter} zoom={selectedDriver ? 14 : 12} />
                                    
                                    {/* CLICK HANDLER: Handles Blocks or Deliveries */}
                                    <MapClickHandler 
                                        isBlockMode={isTrafficMode}
                                        isAddingDelivery={isAddingDelivery}
                                        onBlockAdd={handleBlockMapClick}
                                        onDeliveryAdd={(loc) => { setNewDeliveryLocation(loc); setDeliveryModalOpen(true); }}
                                    />
                                    
                                    <Marker position={WAREHOUSE_COORDS} icon={warehouseIcon}><Popup>Central Warehouse</Popup></Marker>
                                    
                                    {/* NEW: Traffic Blockages Visuals */}
                                    {blockages.map((b, idx) => (
                                        <Circle key={idx} center={b} pathOptions={{ color: 'red', fillColor: 'red', fillOpacity: 0.5 }} radius={300}>
                                            <Popup>⛔ TRAFFIC JAM REPORTED</Popup>
                                        </Circle>
                                    ))}
                                    
                                    {isAddingDelivery && <Marker position={mapCenter} icon={createDeliveryIcon('pending')} opacity={0.5} />}
                                    
                                    {/* Drivers */}
                                    {filteredDrivers.map(d => d.currentLocation?.coordinates && (
                                        <Marker key={d._id} position={[d.currentLocation.coordinates[1], d.currentLocation.coordinates[0]]} icon={createDriverIcon(d.name, d.vehicleType)}>
                                            <Popup>
                                                <strong>{d.name}</strong><br/>
                                                Vehicle: {d.vehicleType}<br/>
                                                Status: {d.isAvailable ? 'Waiting' : 'On Route'}
                                            </Popup>
                                        </Marker>
                                    ))}

                                    {/* Deliveries */}
                                    {filteredDeliveries.map(d => (
                                        <Marker key={d._id} position={[d.pickupLocation.coordinates[1], d.pickupLocation.coordinates[0]]} icon={createDeliveryIcon(d.status)}>
                                            <Popup>
                                                <strong>{d.customerName}</strong> ({d.weight || 5}kg)<br/>
                                                Deadline: {d.deadline || 'N/A'} mins<br/>
                                                Status: {d.status}<br/>
                                                <button className="popup-delete-btn" onClick={() => handleDeleteDelivery(d._id)}>Delete Order</button>
                                            </Popup>
                                        </Marker>
                                    ))}

                                    {/* Routes (Standard) */}
                                    {!comparisonData && filteredRoutes.map(r => r.polyline && (
                                        <Polyline 
                                            key={r._id} 
                                            positions={polyline.decode(r.polyline)} 
                                            color={selectedDriver ? "#e74c3c" : "#0d6efd"} 
                                            weight={selectedDriver ? 6 : 4} 
                                        />
                                    ))}

                                    {/* Routes (Comparison Mode) */}
                                    {comparisonData && (
                                        <>
                                            <Polyline 
                                                positions={polyline.decode(comparisonData.algo_1.polyline)} 
                                                color={comparisonData.algo_1.color} 
                                                weight={5} 
                                                opacity={0.6}
                                                dashArray="10, 10" 
                                            >
                                                <Popup>Strategy: {comparisonData.algo_1.name}</Popup>
                                            </Polyline>
                                            
                                            <Polyline 
                                                positions={polyline.decode(comparisonData.algo_2.polyline)} 
                                                color={comparisonData.algo_2.color} 
                                                weight={6} 
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
        </div>
    );
}

export default AdminDashboard;