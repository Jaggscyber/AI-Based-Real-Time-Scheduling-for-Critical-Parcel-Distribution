import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Home.css';

const Login = () => {
    const [role, setRole] = useState('customer'); 
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');

        try {
            // CRITICAL: Pointing to Port 5000
            const res = await axios.post('http://localhost:5000/api/auth/login', { email, password });
            
            const { token, user } = res.data;
            
            // Save token for protected routes
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(user));

            // --- REDIRECTION LOGIC ---
            if (user.role === 'admin') {
                console.log("Redirecting to Admin Dashboard...");
                navigate('/admin');
            } else if (user.role === 'driver') {
                navigate(`/driver/${user.id}`);
            } else {
                navigate('/customer');
            }

        } catch (err) {
            console.error("Login Error:", err);
            const msg = err.response?.data?.msg || 'Server Connection Failed. Is Node running on Port 5000?';
            setError(msg);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-card-logo">
                    <span>📦</span>
                </div>
                <h2>Welcome Back</h2>
                <p className="auth-card-tagline">Parcel Distribution Control System</p>
                <div className="auth-tabs">
                    <button className={`auth-tab ${role === 'customer' ? 'active' : ''}`} onClick={() => setRole('customer')}>Customer</button>
                    <button className={`auth-tab ${role === 'driver' ? 'active' : ''}`} onClick={() => setRole('driver')}>Driver</button>
                    <button className={`auth-tab ${role === 'admin' ? 'active' : ''}`} onClick={() => setRole('admin')}>Admin</button>
                </div>
                <form onSubmit={handleLogin}>
                    <div className="form-group">
                        <label>Email Address</label>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
                    </div>
                    <div className="form-group">
                        <label>Password</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
                    </div>
                    {error && (
                        <div style={{
                            background: 'rgba(239,68,68,0.15)',
                            border: '1px solid rgba(239,68,68,0.4)',
                            borderRadius: '8px',
                            padding: '10px 14px',
                            color: '#fca5a5',
                            fontSize: '0.88rem',
                            marginBottom: '12px',
                            textAlign: 'center'
                        }}>
                            {error}
                        </div>
                    )}
                    <button type="submit" style={{
                        width: '100%',
                        padding: '13px',
                        background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '10px',
                        fontSize: '1rem',
                        fontWeight: '700',
                        cursor: 'pointer',
                        transition: 'all 0.25s ease',
                        boxShadow: '0 6px 20px rgba(99,102,241,0.4)',
                        letterSpacing: '0.3px'
                    }}
                        onMouseEnter={e => e.target.style.transform = 'translateY(-2px)'}
                        onMouseLeave={e => e.target.style.transform = 'translateY(0)'}
                    >
                        Sign In as {role.charAt(0).toUpperCase() + role.slice(1)}
                    </button>
                </form>
            </div>
            <p style={{textAlign:'center',marginTop:20,fontSize:'0.85rem',color:'rgba(255,255,255,0.45)',position:'relative',zIndex:1}}>
                New customer?{' '}
                <a href="/customer-login" style={{color:'#818cf8',fontWeight:600,textDecoration:'none'}}>Create an account →</a>
            </p>
        </div>
    );
};

export default Login;