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
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// --- 3. SOCKET.IO ---
// --- 3. SOCKET.IO ---
const io = new Server(server, {
  cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] }
});

app.set('socketio', io);

// NEW: bridge driver GPS → REST (fuel + location)
io.on('connection', (socket) => {
  console.log('Driver connected:', socket.id);

  socket.on('updateDriverLocation', async (data) => {
    try {
      const { driverId, location } = data;
      if (!driverId || !location || !location.coordinates) return;

      const [lng, lat] = location.coordinates;

      // Call our REST controller to update DB + fuel + alerts
      await fetch(`http://localhost:5000/api/drivers/${driverId}/update-location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng })
      });
    } catch (err) {
      console.error('GPS bridge error:', err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log('Driver disconnected:', socket.id);
  });
});


// --- 4. ROUTES ---
//ALL ROUTES ARE NOW ACTIVE
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/drivers', require('./routes/driverRoutes'));
app.use('/api/deliveries', require('./routes/deliveryRoutes'));
app.use('/api/routes', require('./routes/routesRoutes')); // <-- UNCOMMENTED THIS
app.use('/api/schedule', require('./routes/scheduleRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/fuel', require('./routes/utilsRoutes'));
app.use('/api/traffic', require('./routes/utilsRoutes'));
app.use('/api/breakdown', require('./routes/utilsRoutes'));

// --- 5. START SERVER ---
const PORT = 5000; // Matches your AdminDashboard.js
server.listen(PORT, () => console.log(`Node Server running on port ${PORT}`));