// controllers/scheduleController.js
const axios = require('axios');
const Driver = require('../models/driverModel');
const Delivery = require('../models/deliveryModel');
const Route = require('../models/routeModel');

exports.generateSchedule = async (req, res) => {
  try {
    // 1. Fetch all available drivers and pending deliveries from MongoDB
    const availableDrivers = await Driver.find({ isAvailable: true });
    const pendingDeliveries = await Delivery.find({ status: 'pending' });

    if (pendingDeliveries.length === 0) {
      return res.status(200).json({ message: 'No pending deliveries to schedule.' });
    }

    // 2. Call the Python AI microservice
    const aiServiceUrl = 'http://127.0.0.1:5000/schedule';
    const response = await axios.post(aiServiceUrl, {
      deliveries: pendingDeliveries,
      drivers: availableDrivers,
    });

    const optimizedRoutes = response.data;

    // 3. Save the generated routes to the database and update delivery statuses
    for (const driverId in optimizedRoutes) {
      const deliveryIds = optimizedRoutes[driverId].map(delivery => delivery._id);

      if (deliveryIds.length > 0) {
        // Create a new route document
        const newRoute = new Route({
          driver: driverId,
          stops: deliveryIds,
        });
        await newRoute.save();

        // Update the status of these deliveries to 'assigned'
        await Delivery.updateMany(
          { _id: { $in: deliveryIds } },
          { $set: { status: 'assigned', assignedDriver: driverId } }
        );
      }
    }

    // 4. Notify frontend clients via WebSocket
    const io = req.app.get('socketio');
    io.emit('scheduleUpdated', { message: 'New routes have been generated!' });

    res.status(200).json({ success: true, routes: optimizedRoutes });
  } catch (error) {
    console.error('Error generating schedule:', error.message);
    res.status(500).send('Server Error while generating schedule.');
  }
};
