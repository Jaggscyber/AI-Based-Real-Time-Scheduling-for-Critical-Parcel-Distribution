// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import AdminDashboard from './AdminDashboard';
import DriverDashboard from './DriverDashboard';
import './App.css';

// A simple home page with links to the dashboards
function HomePage() {
  return (
    <div style={{ textAlign: 'center', padding: '50px' }}>
      <h1>Parcel Distribution System</h1>
      <nav>
        <Link to="/admin" style={{ margin: '20px', fontSize: '1.2rem' }}>Admin Dashboard</Link>
        {/* In a real app, you would get the driver ID after login */}
        <Link to="/driver/686e07c93886ceda17f75e7b" style={{ margin: '20px', fontSize: '1.2rem' }}>Driver Dashboard (Demo)</Link>
      </nav>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/driver/:driverId" element={<DriverDashboard />} />
      </Routes>
    </Router>
  );
}

export default App;
