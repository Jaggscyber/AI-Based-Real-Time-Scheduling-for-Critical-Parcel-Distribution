const User = require('../models/userModel');
const Driver = require('../models/driverModel');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

// ── LOGIN ─────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
    console.log("🔑 Login Attempt:", req.body.email);
    try {
        const { email, password } = req.body;
        const normalizedEmail = email.toLowerCase().trim();

        const user = await User.findOne({ email: normalizedEmail });
        if (!user) {
            return res.status(400).json({ msg: 'No account found with this email. Please register first.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ msg: 'Incorrect password. Please try again.' });
        }

        let responseId = user.id;
        if (user.role === 'driver') {
            const driver = await Driver.findOne({ email: normalizedEmail });
            if (!driver) {
                return res.status(400).json({ msg: 'Driver profile missing. Please contact admin.' });
            }
            responseId = driver._id;
        }

        console.log("✅ Login Success:", user.role);
        const payload = { user: { id: user.id, role: user.role } };
        jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' }, (err, token) => {
            if (err) throw err;
            res.json({
                token,
                user: {
                    id: responseId,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role
                }
            });
        });

    } catch (err) {
        console.error('❌ Auth Server Error:', err.message);
        res.status(500).send('Server Error');
    }
};

// ── REGISTER (Customer Self-Registration) ────────────────────────────────────
exports.register = async (req, res) => {
    console.log("📝 Register Attempt:", req.body.email);
    try {
        const { name, email, password, phone } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ msg: 'Name, email, and password are required.' });
        }
        if (password.length < 6) {
            return res.status(400).json({ msg: 'Password must be at least 6 characters.' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const existing = await User.findOne({ email: normalizedEmail });
        if (existing) {
            return res.status(400).json({ msg: 'An account with this email already exists. Please login.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({
            name: name.trim(),
            email: normalizedEmail,
            password: hashedPassword,
            phone: phone ? phone.trim() : '',
            role: 'customer'
        });
        await newUser.save();

        console.log("✅ New customer registered:", normalizedEmail);
        const payload = { user: { id: newUser.id, role: 'customer' } };
        jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' }, (err, token) => {
            if (err) throw err;
            res.status(201).json({
                token,
                user: {
                    id: newUser.id,
                    name: newUser.name,
                    email: newUser.email,
                    phone: newUser.phone,
                    role: 'customer'
                }
            });
        });

    } catch (err) {
        console.error('❌ Register Error:', err.message);
        res.status(500).send('Server Error');
    }
};

// ── GET PROFILE (JWT-protected) ───────────────────────────────────────────────
exports.getProfile = async (req, res) => {
    try {
        // req.user is set by middleware
        const user = await User.findById(req.user.id).select('-password');
        if (!user) return res.status(404).json({ msg: 'User not found' });
        res.json(user);
    } catch (err) {
        console.error('❌ Profile Error:', err.message);
        res.status(500).send('Server Error');
    }
};