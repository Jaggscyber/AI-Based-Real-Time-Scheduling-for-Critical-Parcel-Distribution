import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import './App.css';

// Fix for Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
    iconUrl: require('leaflet/dist/images/marker-icon.png'),
    shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const CustomerDashboard = () => {
    const [packageId, setPackageId] = useState('');
    const [activePackage, setActivePackage] = useState(null);
    const [isTracking, setIsTracking] = useState(false);

    const handleSearch = (e) => {
        e.preventDefault();
        setIsTracking(true);
        
        // --- MOCK DATA FOR DEMO ---
        setTimeout(() => {
            if(packageId) {
                setActivePackage({
                    id: packageId,
                    status: 'In Transit',
                    eta: '15 mins',
                    items: ['Wireless Headphones', 'USB-C Cable'],
                    driverName: 'Ravi Kumar',
                    driverPhone: '+91 98765 43210',
                    currentLocation: [13.0827, 80.2707], // Chennai
                    destination: [13.0850, 80.2750]
                });
            }
            setIsTracking(false);
        }, 800);
    };

    return (
        <div className="dashboard" style={{ background: '#f4f7f6' }}>
            <header style={{ background: '#2c3e50' }}>
                <h1>Customer Portal</h1>
            </header>

            <div className="main-content" style={{ flexDirection: 'column', padding: '20px', overflowY: 'auto' }}>
                
                {!activePackage ? (
                    // Search View
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'center', 
                        alignItems: 'center', 
                        height: '80%', 
                        flexDirection: 'column' 
                    }}>
                        <div className="panel" style={{ width: '100%', maxWidth: '500px', textAlign: 'center', padding: '40px' }}>
                            <h2 style={{ color: '#2c3e50' }}>Track Your Order</h2>
                            <p style={{ color: '#666', marginBottom: '20px' }}>Enter your tracking ID to see real-time status.</p>
                            
                            <form onSubmit={handleSearch}>
                                <input 
                                    type="text" 
                                    placeholder="e.g., TRACK123456" 
                                    value={packageId} 
                                    onChange={e => setPackageId(e.target.value)}
                                    style={{ 
                                        padding: '15px', 
                                        width: '100%', 
                                        borderRadius: '30px', 
                                        border: '1px solid #ccc', 
                                        marginBottom: '20px',
                                        fontSize: '1.1rem',
                                        textAlign: 'center'
                                    }}
                                    required
                                />
                                <button type="submit" disabled={isTracking} className="btn-main btn-primary" style={{ width: '100%' }}>
                                    {isTracking ? 'Locating Package...' : 'Track Package'}
                                </button>
                            </form>
                        </div>
                    </div>
                ) : (
                    // Tracking View
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
                        
                        <button onClick={() => setActivePackage(null)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', fontSize: '1rem' }}>
                            ← Back to Search
                        </button>

                        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', height: '100%' }}>
                            {/* Info Panel */}
                            <div className="panel" style={{ flex: '1', minWidth: '300px', maxHeight: '600px' }}>
                                <div style={{ borderBottom: '1px solid #eee', paddingBottom: '15px', marginBottom: '15px' }}>
                                    <h3 style={{ margin: 0 }}>Order #{activePackage.id}</h3>
                                    <span style={{ 
                                        display: 'inline-block', 
                                        padding: '5px 10px', 
                                        borderRadius: '15px', 
                                        background: '#fff3cd', 
                                        color: '#856404', 
                                        fontWeight: 'bold',
                                        marginTop: '10px',
                                        fontSize: '0.9rem'
                                    }}>
                                        ● {activePackage.status.toUpperCase()}
                                    </span>
                                </div>

                                <div className="delivery-counts">
                                    <h4 style={{ color: '#2c3e50' }}>Estimated Arrival</h4>
                                    <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#28a745', margin: '5px 0' }}>{activePackage.eta}</p>
                                </div>

                                <div style={{ marginTop: '20px' }}>
                                    <h4>Driver Details</h4>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginTop: '10px' }}>
                                        <div style={{ width: '50px', height: '50px', background: '#e9ecef', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>🚚</div>
                                        <div>
                                            <p style={{ margin: 0, fontWeight: 'bold' }}>{activePackage.driverName}</p>
                                            <p style={{ margin: 0, color: '#666', fontSize: '0.9rem' }}>{activePackage.driverPhone}</p>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ marginTop: '20px' }}>
                                    <h4>Package Contents</h4>
                                    <ul style={{ paddingLeft: '20px', color: '#555' }}>
                                        {activePackage.items.map((item, i) => <li key={i} style={{ marginBottom: '5px' }}>{item}</li>)}
                                    </ul>
                                </div>
                            </div>

                            {/* Map Panel */}
                            <div className="map-container" style={{ flex: '2', minWidth: '300px', minHeight: '400px', borderRadius: '10px', overflow: 'hidden', border: '1px solid #ddd' }}>
                                <MapContainer center={activePackage.currentLocation} zoom={13} style={{ height: '100%', width: '100%' }}>
                                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                                    <Marker position={activePackage.currentLocation}>
                                        <Popup>
                                            <b>{activePackage.driverName}</b> is here.
                                        </Popup>
                                    </Marker>
                                </MapContainer>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CustomerDashboard;