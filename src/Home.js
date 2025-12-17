import React from 'react';
import { Link } from 'react-router-dom';
import './Home.css';

const Home = () => {
    return (
        <div className="home-page">
            {/* Navbar */}
            <nav style={{ padding: '1rem 2rem', background: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>
                <h2 style={{ color: '#2c3e50', margin: 0 }}>ParcelAI</h2>
                <div>
                    <Link to="/login" className="btn-main" style={{ color: '#2c3e50', fontSize: '1rem' }}>Login</Link>
                    <Link to="/apply-driver" className="btn-main btn-primary" style={{ fontSize: '0.9rem', padding: '8px 20px' }}>Become a Driver</Link>
                </div>
            </nav>

            {/* Hero */}
            <header className="hero-section">
                <h1 className="hero-title">AI-Powered Logistics</h1>
                <p className="hero-subtitle">Real-time scheduling, intelligent routing, and eco-friendly distribution.</p>
                <div className="cta-group">
                    <Link to="/track" className="btn-main btn-primary">Track Your Package</Link>
                    <Link to="/login" className="btn-main btn-outline">Admin / Driver Login</Link>
                </div>
            </header>

            {/* Features */}
            <section className="features-section">
                <h2>Why Choose Us?</h2>
                <div className="features-grid">
                    <div className="feature-card">
                        <div className="feature-icon">🤖</div>
                        <h3>AI Optimization</h3>
                        <p>Ant Colony Optimization ensures the fastest routes.</p>
                    </div>
                    <div className="feature-card">
                        <div className="feature-icon">🚦</div>
                        <h3>Real-Time Traffic</h3>
                        <p>Dynamic rerouting based on current traffic conditions.</p>
                    </div>
                    <div className="feature-card">
                        <div className="feature-icon">📦</div>
                        <h3>Live Tracking</h3>
                        <p>Customers get precise ETAs and driver location.</p>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default Home;