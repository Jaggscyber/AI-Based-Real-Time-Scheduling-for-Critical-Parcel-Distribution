import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './Home';
import Login from './Login';
import DriverApply from './DriverApply';
import AdminDashboard from './AdminDashboard';
import DriverDashboard from './DriverDashboard';
import CustomerDashboard from './CustomerDashboard';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/apply-driver" element={<DriverApply />} />
        
        {/* Customer Routes */}
        <Route path="/track" element={<CustomerDashboard />} />
        <Route path="/my-packages" element={<CustomerDashboard />} />

        {/* Protected/Private Routes */}
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/driver/:driverId" element={<DriverDashboard />} />
      </Routes>
    </Router>
  );
}

export default App;