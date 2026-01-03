const axios = require('axios');
const Driver = require('../models/driverModel');
const Delivery = require('../models/deliveryModel');
const Route = require('../models/routeModel');

exports.generateSchedule = async (req, res) => {
  try {
    // 1. ACCEPT BLOCKAGES from Frontend
    const { algorithm, blockages } = req.body; 

    const [availableDrivers, pendingDeliveries] = await Promise.all([
        Driver.find({ isAvailable: true }), 
        Delivery.find({ status: 'pending' })
    ]);

    if (pendingDeliveries.length === 0) return res.status(200).json({ message: 'No pending deliveries.' });
    if (availableDrivers.length === 0) return res.status(400).json({ message: 'No drivers available.' });

    // --- ZONE FALLBACK LOGIC ---
    const deliveryZones = [...new Set(pendingDeliveries.map(d => d.zone || 'Unzoned'))];
    let capableDrivers = availableDrivers.filter(d => d.assignedZone && deliveryZones.includes(d.assignedZone));
    if (capableDrivers.length === 0) capableDrivers = availableDrivers;

    // AI SERVICE ON 5001
    const aiServiceUrl = 'http://127.0.0.1:5001/schedule'; 
    
    const payload = {
      deliveries: pendingDeliveries,
      drivers: capableDrivers,
      algorithm: algorithm || 'genetic',
      blockages: blockages || [] // Pass blockages to AI
    };
    
    const response = await axios.post(aiServiceUrl, payload);
    const optimizedRoutes = response.data;

    const databaseUpdatePromises = [];
    const summaryMessages = [];

    for (const routeKey in optimizedRoutes) {
        const routeData = optimizedRoutes[routeKey];
        if (!routeData || !routeData.stops || routeData.stops.length === 0) continue;

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
        databaseUpdatePromises.push(newRoute.save());

        databaseUpdatePromises.push(
            Delivery.updateMany({ _id: { $in: deliveryIds } }, { $set: { status: 'assigned', assignedDriver: driverId } })
        );
        databaseUpdatePromises.push(
            Driver.findByIdAndUpdate(driverId, { isAvailable: false })
        );
        summaryMessages.push(`${routeData.driver.name} (${deliveryIds.length} stops)`);
    }

    await Promise.all(databaseUpdatePromises);

    const finalMessage = `Schedule Generated with ${blockages ? blockages.length : 0} active blockages.`;
    const io = req.app.get('socketio');
    if(io) io.emit('scheduleUpdated', { message: finalMessage });
    
    res.status(200).json({ success: true, message: finalMessage });

  } catch (error) {
    console.error('Error in generateSchedule:', error.message);
    res.status(500).json({ message: 'AI Service Error. Is Python running on 5001?' });
  }
};