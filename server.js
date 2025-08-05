// server.js
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
const routesRoutes = require('./routes/routesRoutes'); // 1. Make sure this line is here

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Connect to Database
connectDB();

// Middlewares
app.set('socketio', io);
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/routes', routesRoutes); // 2. THIS IS THE CRUCIAL LINE TO ADD

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5001;

// Start the server
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
