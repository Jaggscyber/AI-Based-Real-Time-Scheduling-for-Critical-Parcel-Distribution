// src/AdminDashboard.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';

// The URL of our backend server
const BACKEND_URL = "http://localhost:5001";

// Initialize the socket connection
const socket = io(BACKEND_URL);

function AdminDashboard() {
  const [drivers, setDrivers] = useState([]);
  const [deliveries, setDeliveries] = useState([]);

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const driversRes = await axios.get(`${BACKEND_URL}/api/drivers`);
        setDrivers(driversRes.data);

        const deliveriesRes = await axios.get(`${BACKEND_URL}/api/deliveries`);
        setDeliveries(deliveriesRes.data);
      } catch (error) {
        console.error("Error fetching initial data:", error);
      }
    };
    fetchData();
  }, []);

  // Handle real-time updates
  useEffect(() => {
    socket.on('driverLocationUpdated', (updatedDriver) => {
      setDrivers(prevDrivers =>
        prevDrivers.map(driver =>
          driver._id === updatedDriver._id ? updatedDriver : driver
        )
      );
    });

    socket.on('deliveryStatusUpdated', (updatedDelivery) => {
      setDeliveries(prevDeliveries =>
        prevDeliveries.map(delivery =>
          delivery._id === updatedDelivery._id ? updatedDelivery : delivery
        )
      );
    });

    socket.on('scheduleUpdated', () => {
      axios.get(`${BACKEND_URL}/api/deliveries`).then(res => setDeliveries(res.data));
    });

    return () => {
      socket.off('driverLocationUpdated');
      socket.off('deliveryStatusUpdated');
      socket.off('scheduleUpdated');
    };
  }, []);

  return (
    <div className="dashboard">
      <header>
        <h1>Real-Time Parcel Distribution Dashboard</h1>
      </header>
      <div className="main-content">
        <div className="data-panels">
          <div className="panel">
            <h3>Drivers ({drivers.length})</h3>
            <ul>
              {drivers.map(driver => (
                <li key={driver._id}>
                  <strong>{driver.name}</strong> - Status: {driver.isAvailable ? 'Available' : 'Unavailable'}
                </li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <h3>Deliveries ({deliveries.length})</h3>
            <ul>
              {deliveries.map(delivery => (
                <li key={delivery._id}>
                  ID: {delivery._id.slice(-6)} - <strong>Status: {delivery.status}</strong>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="map-container">
          <MapContainer center={[12.9716, 77.5946]} zoom={12}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            {drivers.map(driver =>
              driver.currentLocation?.coordinates && (
                <Marker key={driver._id} position={[driver.currentLocation.coordinates[1], driver.currentLocation.coordinates[0]]}>
                  <Popup>
                    <strong>Driver: {driver.name}</strong><br />
                    Available: {driver.isAvailable ? 'Yes' : 'No'}
                  </Popup>
                </Marker>
              )
            )}
            {deliveries.map(delivery => (
              <Marker
                key={`pickup-${delivery._id}`}
                position={[delivery.pickupLocation.coordinates[1], delivery.pickupLocation.coordinates[0]]}
              >
                <Popup>
                  <strong>Pickup:</strong> Delivery {delivery._id.slice(-6)}<br />
                  Status: {delivery.status}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
