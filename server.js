// backend/server.js

const express = require('express');
const cors = require('cors');
require('dotenv').config();
const http = require('http');
const { Server } = require("socket.io");

// Import DB connection
const connectDB = require('./config/db');

// Import Route Files
const deliveryRoutes = require('./routes/deliveryRoutes');
const driverRoutes = require('./routes/driverRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const routesRoutes = require('./routes/routesRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // Your frontend URL
    methods: ["GET", "POST", "PUT"]
  }
});

// Connect to Database
connectDB();

// --- Middlewares ---

// THIS IS THE CORRECTED LINE: Configure CORS for all Express API routes
app.use(cors({
  origin: "http://localhost:3000"
}));

app.set('socketio', io); // Make io accessible in controllers
app.use(express.json());

// API Routes
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/routes', routesRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });

  // Listen for driver location updates from the driver dashboard
  socket.on('updateDriverLocation', async (data) => {
    try {
      const { driverId, location } = data;
      const driver = await Driver.findByIdAndUpdate(
        driverId,
        { currentLocation: location },
        { new: true }
      );
      if (driver) {
        // Broadcast the updated location to all connected clients (i.e., the admin dashboard)
        io.emit('driverLocationUpdated', driver);
      }
    } catch (error) {
      console.error('Error updating driver location from socket:', error);
    }
  });
});

const PORT = process.env.PORT || 5001;

// Start the server
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));