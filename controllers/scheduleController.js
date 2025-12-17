const axios = require('axios');
const Driver = require('../models/driverModel');
const Delivery = require('../models/deliveryModel');
const Route = require('../models/routeModel');

exports.generateSchedule = async (req, res) => {
  try {
    const { algorithm, simulate_traffic } = req.body; 

    const [availableDrivers, pendingDeliveries] = await Promise.all([
        Driver.find({ isAvailable: true }), 
        Delivery.find({ status: 'pending' })
    ]);

    if (pendingDeliveries.length === 0) return res.status(200).json({ message: 'No pending deliveries.' });
    if (availableDrivers.length === 0) return res.status(400).json({ message: 'No drivers available.' });

    // AI SERVICE ON 5001
    const aiServiceUrl = 'http://127.0.0.1:5001/schedule'; 
    const payload = {
      deliveries: pendingDeliveries,
      drivers: availableDrivers,
      algorithm: algorithm || 'genetic',
      simulate_traffic: simulate_traffic || false
    };
    
    const response = await axios.post(aiServiceUrl, payload);
    const optimizedRoutes = response.data;

    for (const routeKey in optimizedRoutes) {
        const routeData = optimizedRoutes[routeKey];
        const driverId = routeData.driver._id;
        const deliveryIds = routeData.stops.map(d => d._id);

        const newRoute = new Route({
            driver: driverId,
            stops: deliveryIds,
            status: 'assigned',
            polyline: routeData.polyline,
            totalDistance: routeData.total_distance,
            totalDuration: routeData.total_duration,
            legs: routeData.legs,
        });
        await newRoute.save();

        await Delivery.updateMany({ _id: { $in: deliveryIds } }, { $set: { status: 'assigned', assignedDriver: driverId } });
        await Driver.findByIdAndUpdate(driverId, { isAvailable: false });
    }

    res.status(200).json({ success: true, message: 'AI Schedule Generated' });

  } catch (error) {
    console.error('Error in generateSchedule:', error.message);
    res.status(500).json({ message: 'AI Service Error. Is Python running on 5001?' });
  }
};