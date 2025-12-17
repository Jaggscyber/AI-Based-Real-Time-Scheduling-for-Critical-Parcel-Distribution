import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Home.css';

const DriverApply = () => {
    // Added password and phone to state
    const [formData, setFormData] = useState({ 
        name: '', 
        email: '', 
        password: '', 
        phone: '', 
        vehicleType: 'Bike', 
        license: '' 
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            // Call the new Backend Registration Endpoint
            const res = await axios.post('http://localhost:5001/api/drivers/register', formData);
            
            alert('Registration Successful! You can now log in.');
            navigate('/login');
            
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.msg || 'Registration failed. Try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    return (
        <div className="auth-container">
            <div className="auth-card" style={{ maxWidth: '500px' }}>
                <h2>Driver Registration</h2>
                <p style={{ textAlign: 'center', color: '#666', marginBottom: '20px' }}>
                    Create your account to start delivering.
                </p>
                
                {error && <div style={{background:'#f8d7da', color:'#721c24', padding:'10px', borderRadius:'5px', marginBottom:'15px', textAlign:'center'}}>{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Full Name</label>
                        <input 
                            type="text" name="name" required 
                            onChange={handleChange} placeholder="John Doe"
                        />
                    </div>
                    
                    <div className="form-group">
                        <label>Email Address</label>
                        <input 
                            type="email" name="email" required 
                            onChange={handleChange} placeholder="john@example.com"
                        />
                    </div>

                    <div className="form-group">
                        <label>Password</label>
                        <input 
                            type="password" name="password" required 
                            onChange={handleChange} placeholder="Create a secure password"
                        />
                    </div>

                    <div className="form-group">
                        <label>Phone Number</label>
                        <input 
                            type="text" name="phone" required 
                            onChange={handleChange} placeholder="+91 98765 43210"
                        />
                    </div>

                    <div className="form-group">
                        <label>Vehicle Type</label>
                        <select name="vehicleType" onChange={handleChange}>
                            <option value="Bike">Motorbike / Scooter</option>
                            <option value="Small Van">Small Van</option>
                            <option value="Truck">Large Truck</option>
                        </select>
                    </div>

                    <div className="form-group">
                        <label>Driving License Number</label>
                        <input 
                            type="text" name="license" required 
                            onChange={handleChange} placeholder="DL-123456789"
                        />
                    </div>

                    <button type="submit" className="btn-main btn-primary" style={{width: '100%'}} disabled={loading}>
                        {loading ? 'Registering...' : 'Create Driver Account'}
                    </button>
                </form>
                
                <button 
                    onClick={() => navigate('/')} 
                    style={{ width: '100%', background: 'none', border: 'none', color: '#666', marginTop: '15px', cursor: 'pointer' }}
                >
                    Cancel & Return Home
                </button>
            </div>
        </div>
    );
};

export default DriverApply;