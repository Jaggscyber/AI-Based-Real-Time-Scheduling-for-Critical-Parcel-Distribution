import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

const BACKEND_URL = 'http://localhost:5000';

const CustomerAuth = () => {
    const [tab, setTab] = useState('login'); // 'login' | 'register'
    const navigate = useNavigate();

    // Login state
    const [loginEmail, setLoginEmail] = useState('');
    const [loginPass, setLoginPass] = useState('');
    const [loginError, setLoginError] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);

    // Register state
    const [regName, setRegName] = useState('');
    const [regEmail, setRegEmail] = useState('');
    const [regPhone, setRegPhone] = useState('');
    const [regPass, setRegPass] = useState('');
    const [regPassConfirm, setRegPassConfirm] = useState('');
    const [regError, setRegError] = useState('');
    const [regLoading, setRegLoading] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoginError(''); setLoginLoading(true);
        try {
            const res = await axios.post(`${BACKEND_URL}/api/auth/login`, { email: loginEmail, password: loginPass });
            const { token, user } = res.data;
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(user));
            if (user.role === 'admin') navigate('/admin');
            else if (user.role === 'driver') navigate(`/driver/${user.id}`);
            else navigate('/customer');
        } catch (err) {
            setLoginError(err.response?.data?.msg || 'Login failed. Check your credentials.');
        } finally { setLoginLoading(false); }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        setRegError('');
        if (regPass !== regPassConfirm) { setRegError('Passwords do not match.'); return; }
        if (regPass.length < 6) { setRegError('Password must be at least 6 characters.'); return; }
        setRegLoading(true);
        try {
            const res = await axios.post(`${BACKEND_URL}/api/auth/register`, {
                name: regName, email: regEmail, phone: regPhone, password: regPass
            });
            const { token, user } = res.data;
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(user));
            navigate('/customer');
        } catch (err) {
            setRegError(err.response?.data?.msg || 'Registration failed. Try again.');
        } finally { setRegLoading(false); }
    };

    const accent = '#6366f1';
    const accentDark = '#4f46e5';

    return (
        <div style={{
            minHeight: '100vh', background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Inter', 'Segoe UI', sans-serif", padding: '24px'
        }}>
            {/* Glowing blobs */}
            <div style={{ position: 'fixed', top: '-100px', left: '-100px', width: 400, height: 400, borderRadius: '50%', background: 'rgba(99,102,241,0.15)', filter: 'blur(80px)', pointerEvents: 'none' }} />
            <div style={{ position: 'fixed', bottom: '-100px', right: '-100px', width: 400, height: 400, borderRadius: '50%', background: 'rgba(139,92,246,0.12)', filter: 'blur(80px)', pointerEvents: 'none' }} />

            <div style={{
                width: '100%', maxWidth: 440,
                background: 'rgba(255,255,255,0.05)',
                backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 24, padding: '40px 36px',
                boxShadow: '0 25px 50px rgba(0,0,0,0.4)'
            }}>
                {/* Logo */}
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>📦</div>
                    <h1 style={{ margin: 0, color: 'white', fontSize: '1.6rem', fontWeight: 800, letterSpacing: -0.5 }}>ParcelTrack</h1>
                    <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>Smart delivery at your fingertips</p>
                </div>

                {/* Tab switcher */}
                <div style={{ display: 'flex', background: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: 4, marginBottom: 28 }}>
                    {[['login', 'Sign In'], ['register', 'Create Account']].map(([val, label]) => (
                        <button key={val} onClick={() => { setTab(val); setLoginError(''); setRegError(''); }}
                            style={{
                                flex: 1, padding: '10px', border: 'none', borderRadius: 10,
                                cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem', transition: 'all 0.2s',
                                background: tab === val ? accent : 'transparent',
                                color: tab === val ? 'white' : 'rgba(255,255,255,0.55)',
                                boxShadow: tab === val ? '0 2px 12px rgba(99,102,241,0.4)' : 'none'
                            }}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* ── LOGIN FORM ── */}
                {tab === 'login' && (
                    <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {[
                            { label: 'Email Address', value: loginEmail, set: setLoginEmail, type: 'email', ph: 'your@email.com' },
                            { label: 'Password', value: loginPass, set: setLoginPass, type: 'password', ph: '••••••••' }
                        ].map(({ label, value, set, type, ph }) => (
                            <div key={label}>
                                <label style={{ display: 'block', color: 'rgba(255,255,255,0.7)', fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>{label}</label>
                                <input type={type} value={value} onChange={e => set(e.target.value)} placeholder={ph} required
                                    style={{
                                        width: '100%', padding: '12px 14px', borderRadius: 12,
                                        border: '1px solid rgba(255,255,255,0.12)',
                                        background: 'rgba(255,255,255,0.08)', color: 'white',
                                        fontSize: '0.95rem', outline: 'none', boxSizing: 'border-box',
                                        transition: 'border 0.2s'
                                    }}
                                    onFocus={e => e.target.style.borderColor = accent}
                                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
                                />
                            </div>
                        ))}
                        {loginError && <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', padding: '10px 14px', borderRadius: 10, fontSize: '0.85rem' }}>{loginError}</div>}
                        <button type="submit" disabled={loginLoading}
                            style={{ marginTop: 4, padding: '14px', background: `linear-gradient(135deg, ${accent}, ${accentDark})`, color: 'white', border: 'none', borderRadius: 12, cursor: loginLoading ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '1rem', boxShadow: '0 4px 15px rgba(99,102,241,0.4)', opacity: loginLoading ? 0.7 : 1, transition: 'all 0.2s' }}>
                            {loginLoading ? '⏳ Signing in...' : 'Sign In →'}
                        </button>
                    </form>
                )}

                {/* ── REGISTER FORM ── */}
                {tab === 'register' && (
                    <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {[
                            { label: 'Full Name', value: regName, set: setRegName, type: 'text', ph: 'Your full name' },
                            { label: 'Email Address', value: regEmail, set: setRegEmail, type: 'email', ph: 'your@email.com' },
                            { label: 'Phone Number', value: regPhone, set: setRegPhone, type: 'tel', ph: '+91 98765 43210' },
                            { label: 'Password', value: regPass, set: setRegPass, type: 'password', ph: 'Min. 6 characters' },
                            { label: 'Confirm Password', value: regPassConfirm, set: setRegPassConfirm, type: 'password', ph: 'Repeat password' }
                        ].map(({ label, value, set, type, ph }) => (
                            <div key={label}>
                                <label style={{ display: 'block', color: 'rgba(255,255,255,0.7)', fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>{label}</label>
                                <input type={type} value={value} onChange={e => set(e.target.value)} placeholder={ph}
                                    required={label !== 'Phone Number'}
                                    style={{
                                        width: '100%', padding: '12px 14px', borderRadius: 12,
                                        border: '1px solid rgba(255,255,255,0.12)',
                                        background: 'rgba(255,255,255,0.08)', color: 'white',
                                        fontSize: '0.95rem', outline: 'none', boxSizing: 'border-box'
                                    }}
                                    onFocus={e => e.target.style.borderColor = accent}
                                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
                                />
                            </div>
                        ))}
                        {regError && <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', padding: '10px 14px', borderRadius: 10, fontSize: '0.85rem' }}>{regError}</div>}
                        <button type="submit" disabled={regLoading}
                            style={{ marginTop: 4, padding: '14px', background: `linear-gradient(135deg, #10b981, #059669)`, color: 'white', border: 'none', borderRadius: 12, cursor: regLoading ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '1rem', boxShadow: '0 4px 15px rgba(16,185,129,0.3)', opacity: regLoading ? 0.7 : 1 }}>
                            {regLoading ? '⏳ Creating account...' : 'Create Account →'}
                        </button>
                    </form>
                )}

                {/* Public track link */}
                <div style={{ marginTop: 24, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem' }}>
                    Just need to track a package?{' '}
                    <Link to="/track" style={{ color: accent, fontWeight: 600, textDecoration: 'none' }}>
                        Track without login →
                    </Link>
                </div>

                {/* Back to home */}
                <div style={{ marginTop: 12, textAlign: 'center' }}>
                    <Link to="/" style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.78rem', textDecoration: 'none' }}>← Back to home</Link>
                </div>
            </div>
        </div>
    );
};

export default CustomerAuth;
