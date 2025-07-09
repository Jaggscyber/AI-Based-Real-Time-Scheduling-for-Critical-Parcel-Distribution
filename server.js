// server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const http = require('http'); // 1. Import http
const { Server } = require("socket.io"); // 2. Import Server from socket.io

const connectDB = require('./config/db');
const deliveryRoutes = require('./routes/deliveryRoutes');
const driverRoutes = require('./routes/driverRoutes');

const app = express();
const server = http.createServer(app); // 3. Create an HTTP server with the Express app

// 4. Initialize Socket.IO with CORS configuration
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // The origin of your React frontend
    methods: ["GET", "POST"]
  }
});

// Connect to Database
connectDB();

// Middlewares
app.set('socketio', io); // Make io accessible to our routes
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/drivers', driverRoutes);

// 5. Set up a basic Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5001;
// 6. Start the server using the http server instance
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));