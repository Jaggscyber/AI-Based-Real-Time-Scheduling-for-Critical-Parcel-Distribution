import React, { useState } from 'react';
import axios from 'axios';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import './App.css';

// Fix Leaflet Icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
    iconUrl: require('leaflet/dist/images/marker-icon.png'),
    shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const BACKEND_URL = "http://localhost:5000";

const driverIcon = new L.Icon({ iconUrl: 'https://img.icons8.com/plasticine/100/000000/truck.png', iconSize: [50, 50], iconAnchor: [25, 25] });
const homeIcon = new L.Icon({ iconUrl: 'https://img.icons8.com/plasticine/100/000000/home.png', iconSize: [40, 40], iconAnchor: [20, 40] });

const CustomerDashboard = () => {
    const [packageId, setPackageId] = useState('');
    const [activePackage, setActivePackage] = useState(null);
    const [isTracking, setIsTracking] = useState(false);
    const [error, setError] = useState('');

    const handleSearch = async (e) => {
        e.preventDefault();
        setIsTracking(true);
        setError('');
        setActivePackage(null);

        try {
            // Call the new backend endpoint
            const res = await axios.get(`${BACKEND_URL}/api/deliveries/track/${packageId.trim()}`);
            setActivePackage(res.data);
        } catch (err) {
            setError(err.response?.data?.msg || 'Tracking ID not found. Check the ID and try again.');
        } finally {
            setIsTracking(false);
        }
    };

    return (
        <div className="dashboard" style={{ background: '#f4f7f6', height: '100vh', display:'flex', flexDirection:'column' }}>
            <header style={{ background: '#2c3e50', padding:'1rem', color:'white', textAlign:'center' }}>
                <h1 style={{margin:0}}>📦 Track Your Shipment</h1>
            </header>

            <div style={{ flex:1, padding:'20px', display:'flex', flexDirection:'column', alignItems:'center', overflowY:'auto' }}>
                
                {!activePackage ? (
                    <div className="panel" style={{ width:'100%', maxWidth:'500px', padding:'40px', marginTop:'50px', textAlign:'center' }}>
                        <h2 style={{color:'#2c3e50'}}>Where is my order?</h2>
                        <p>Enter the Tracking ID (e.g., from your receipt) to track.</p>
                        <form onSubmit={handleSearch}>
                            <input 
                                type="text" 
                                placeholder="Paste Tracking ID (e.g., 64f2...)" 
                                value={packageId} 
                                onChange={e => setPackageId(e.target.value)}
                                style={{ padding:'15px', width:'100%', marginBottom:'20px', borderRadius:'5px', border:'1px solid #ccc', fontSize:'1.1rem', textAlign:'center' }}
                                required
                            />
                            <button type="submit" disabled={isTracking} style={{ width:'100%', padding:'15px', background:'#007bff', color:'white', border:'none', borderRadius:'5px', cursor:'pointer' }}>
                                {isTracking ? 'Locating...' : 'Track Package'}
                            </button>
                        </form>
                        {error && <p style={{color:'red', marginTop:'15px'}}>{error}</p>}
                    </div>
                ) : (
                    <div style={{ width:'100%', maxWidth:'1000px', display:'flex', gap:'20px', height:'600px', flexDirection: window.innerWidth < 768 ? 'column' : 'row' }}>
                        {/* INFO PANEL */}
                        <div className="panel" style={{ flex:1, padding:'20px' }}>
                            <button onClick={() => setActivePackage(null)} style={{ background:'none', border:'none', color:'#007bff', cursor:'pointer', marginBottom:'15px' }}>← Search Another</button>
                            
                            <h2 style={{margin:'0 0 10px 0'}}>Status: <span style={{color: activePackage.status === 'delivered' ? 'green' : 'orange'}}>{activePackage.status.toUpperCase()}</span></h2>
                            <p><strong>Customer:</strong> {activePackage.customerName}</p>
                            
                            {activePackage.driverName ? (
                                <div style={{ background:'#f8f9fa', padding:'15px', borderRadius:'8px', marginTop:'20px' }}>
                                    <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                                        <div style={{fontSize:'2rem'}}>🚚</div>
                                        <div>
                                            <strong>{activePackage.driverName}</strong><br/>
                                            <small>{activePackage.driverPhone}</small>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <p style={{fontStyle:'italic', color:'#666'}}>Waiting for driver assignment...</p>
                            )}

                            <div style={{marginTop:'20px'}}>
                                <h4>Items:</h4>
                                <ul>{activePackage.items.map((item, i) => <li key={i}>{item}</li>)}</ul>
                            </div>
                        </div>

                        {/* MAP PANEL */}
                        <div className="map-container" style={{ flex:2, borderRadius:'10px', overflow:'hidden', border:'1px solid #ddd' }}>
                            <MapContainer 
                                center={activePackage.driverLocation ? [activePackage.driverLocation.coordinates[1], activePackage.driverLocation.coordinates[0]] : [13.0827, 80.2707]} 
                                zoom={13} 
                                style={{ height:'100%', width:'100%' }}
                            >
                                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                                
                                {activePackage.driverLocation && (
                                    <Marker position={[activePackage.driverLocation.coordinates[1], activePackage.driverLocation.coordinates[0]]} icon={driverIcon}>
                                        <Popup>Driver</Popup>
                                    </Marker>
                                )}
                                
                                {activePackage.pickupLocation && (
                                    <Marker position={[activePackage.pickupLocation.coordinates[1], activePackage.pickupLocation.coordinates[0]]} icon={homeIcon}>
                                        <Popup>Delivery Location</Popup>
                                    </Marker>
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