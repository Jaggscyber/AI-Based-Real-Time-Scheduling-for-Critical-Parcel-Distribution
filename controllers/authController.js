const User = require('../models/userModel');
const Driver = require('../models/driverModel');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

exports.login = async (req, res) => {
    console.log("🔑 Login Attempt:", req.body.email);
    try {
        const { email, password } = req.body;
        // Normalizing email to lowercase to match the model's lowercase: true
        const normalizedEmail = email.toLowerCase().trim();

        // 1. Check if User exists
        const user = await User.findOne({ email: normalizedEmail });
        if (!user) {
            console.log("❌ Login Failed: User not found");
            return res.status(400).json({ msg: 'User not found. Please Register.' });
        }

        // 2. Check Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.log("❌ Login Failed: Wrong Password");
            return res.status(400).json({ msg: 'Invalid Password' });
        }

        // 3. Get Driver ID if necessary
        let responseId = user.id;
        if (user.role === 'driver') {
            const driver = await Driver.findOne({ email: normalizedEmail });
            if (!driver) {
                console.log("❌ Login Failed: Driver Profile Missing");
                return res.status(400).json({ msg: 'Driver Profile Missing. Register again to fix.' });
            }
            responseId = driver._id;
        }

        // 4. Success
        console.log("✅ Login Success:", user.role);
        const payload = { user: { id: user.id, role: user.role } };
        jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' }, (err, token) => {
            if (err) throw err;
            res.json({ token, user: { id: responseId, name: user.name, role: user.role } });
        });

    } catch (err) {
        console.error('❌ Auth Server Error:', err.message);
        res.status(500).send('Server Error');
    }
};