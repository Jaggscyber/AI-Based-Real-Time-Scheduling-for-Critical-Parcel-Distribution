const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// --- 1. MIDDLEWARE ---
app.use(cors({ 
    origin: "http://localhost:3000", 
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true 
}));
app.use(express.json());

// --- 2. DATABASE ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/parcel_distribution_ai';
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- 3. SOCKET.IO ---
const io = new Server(server, {
    cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] }
});
app.set('socketio', io);

// --- 4. ROUTES ---
// ✅ ALL ROUTES ARE NOW ACTIVE
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/drivers', require('./routes/driverRoutes'));
app.use('/api/deliveries', require('./routes/deliveryRoutes'));
app.use('/api/routes', require('./routes/routesRoutes')); // <-- UNCOMMENTED THIS
app.use('/api/schedule', require('./routes/scheduleRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));

// --- 5. START SERVER ---
const PORT = 5000; // Matches your AdminDashboard.js
server.listen(PORT, () => console.log(`🚀 Node Server running on port ${PORT}`));