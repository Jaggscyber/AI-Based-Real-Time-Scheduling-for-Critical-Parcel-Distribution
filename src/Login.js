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
                navigate('/track');
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
                <h2>Log In</h2>
                <div className="auth-tabs">
                    <button className={`auth-tab ${role === 'customer' ? 'active' : ''}`} onClick={() => setRole('customer')}>Customer</button>
                    <button className={`auth-tab ${role === 'driver' ? 'active' : ''}`} onClick={() => setRole('driver')}>Driver</button>
                    <button className={`auth-tab ${role === 'admin' ? 'active' : ''}`} onClick={() => setRole('admin')}>Admin</button>
                </div>
                <form onSubmit={handleLogin}>
                    <div className="form-group">
                        <label>Email Address</label>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                    </div>
                    <div className="form-group">
                        <label>Password</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
                    </div>
                    {error && <p style={{color: 'red', textAlign: 'center', fontSize:'0.9rem'}}>{error}</p>}
                    <button type="submit" className="btn-main btn-primary" style={{width: '100%'}}>
                        Login as {role.charAt(0).toUpperCase() + role.slice(1)}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Login;