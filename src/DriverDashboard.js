// src/DriverDashboard.js
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import './DriverDashboard.css'; // We will create this file next

const BACKEND_URL = "http://localhost:5001";

function DriverDashboard() {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { driverId } = useParams(); // Gets the driverId from the URL

  useEffect(() => {
    const fetchRoute = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/api/routes/${driverId}`);
        setRoute(res.data);
      } catch (err) {
        setError('No active route found or error fetching data.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchRoute();
  }, [driverId]);

  const handleStatusUpdate = async (deliveryId, newStatus) => {
    try {
      await axios.put(`${BACKEND_URL}/api/deliveries/${deliveryId}/status`, { status: newStatus });
      // Optimistically update the UI
      const updatedStops = route.stops.map(stop =>
        stop._id === deliveryId ? { ...stop, status: newStatus } : stop
      );
      setRoute({ ...route, stops: updatedStops });
    } catch (err) {
      console.error("Failed to update status", err);
      alert("Failed to update status. Please try again.");
    }
  };

  if (loading) return <div className="loading">Loading route...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!route) return <div className="no-route">No active route assigned.</div>;

  return (
    <div className="driver-dashboard">
      <header className="driver-header">
        <h1>Your Route</h1>
        <p>Driver ID: {driverId.slice(-6)}</p>
      </header>
      <div className="stops-list">
        {route.stops.map((stop, index) => (
          <div key={stop._id} className={`stop-card status-${stop.status}`}>
            <h3>Stop {index + 1}: Delivery #{stop._id.slice(-6)}</h3>
            <p><strong>Status:</strong> {stop.status.toUpperCase()}</p>
            <div className="actions">
              {stop.status === 'assigned' && (
                <button onClick={() => handleStatusUpdate(stop._id, 'in_transit')}>
                  Start Driving
                </button>
              )}
              {stop.status === 'in_transit' && (
                <button className="delivered" onClick={() => handleStatusUpdate(stop._id, 'delivered')}>
                  Mark as Delivered
                </button>
              )}
              {stop.status === 'delivered' && (
                 <p className="completed-text">✓ Completed</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default DriverDashboard;
