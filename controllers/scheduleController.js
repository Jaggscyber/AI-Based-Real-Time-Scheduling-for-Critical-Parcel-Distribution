const axios = require('axios');
const Driver = require('../models/driverModel');
const Delivery = require('../models/deliveryModel');
const Route = require('../models/routeModel');

// Define the warehouse location here to be sent to the AI service
const WAREHOUSE_LOCATION = {
    type: 'Point',
    coordinates: [80.2707, 13.0827] // [longitude, latitude] for Chennai
};

exports.generateSchedule = async (req, res) => {
  try {
    // 1. Fetch all necessary data in parallel
    const [allDrivers, pendingDeliveries] = await Promise.all([
        Driver.find({ isAvailable: true }),
        Delivery.find({ status: 'pending' })
    ]);

    // 2. Validate the data before sending to the AI
    if (pendingDeliveries.length === 0) {
      console.log("Generate Schedule: No pending deliveries to schedule.");
      return res.status(200).json({ message: 'No pending deliveries to schedule.' });
    }
    
    // Filter for drivers who have a valid currentLocation set
    const availableDrivers = allDrivers.filter(driver => 
        driver.currentLocation && Array.isArray(driver.currentLocation.coordinates) && driver.currentLocation.coordinates.length === 2
    );

    if (availableDrivers.length === 0) {
        console.error("Generate Schedule: No available drivers with valid locations found.");
        return res.status(400).json({ message: 'No available drivers to assign routes.' });
    }

    const aiServiceUrl = 'http://127.0.0.1:5000/schedule';
    
    // 3. Construct the complete payload for the AI service
    const payload = {
      deliveries: pendingDeliveries,
      drivers: availableDrivers,
      start_location: WAREHOUSE_LOCATION.coordinates
    };

    console.log(`Sending ${payload.deliveries.length} deliveries and ${payload.drivers.length} drivers to AI service...`);

    // 4. Call the AI Service
    const response = await axios.post(aiServiceUrl, payload);
    const optimizedRoutes = response.data;

    // 5. Process the response from the AI
    if (!optimizedRoutes || Object.keys(optimizedRoutes).length === 0) {
        console.log("AI service returned no routes.");
        return res.status(200).json({ message: 'AI could not generate routes for the current set of deliveries.' });
    }

    console.log(`AI service returned ${Object.keys(optimizedRoutes).length} optimized routes. Saving to database...`);
    
    // --- IMPROVEMENT 1: SAFER ROUTE DELETION ---
    // Only delete pending routes for the drivers who are getting new routes assigned.
    const driversInNewSchedule = Object.keys(optimizedRoutes);
    await Route.deleteMany({ 
        status: 'pending',
        driver: { $in: driversInNewSchedule } 
    });

    // --- IMPROVEMENT 2: PARALLEL DATABASE UPDATES ---
    // Create an array to hold all our database update promises
    const databaseUpdatePromises = [];

    for (const driverId in optimizedRoutes) {
      const routeData = optimizedRoutes[driverId];
      if (!routeData || !routeData.stops || routeData.stops.length === 0) continue;

      const deliveryIds = routeData.stops.map(delivery => delivery._id);

      // Create the new route document
      const newRoute = new Route({
        driver: driverId,
        stops: deliveryIds,
        polyline: routeData.polyline,
        totalDistance: routeData.total_distance,
        totalDuration: routeData.total_duration,
        legs: routeData.legs,
      });
      // Add the save promise to our array (don't await yet)
      databaseUpdatePromises.push(newRoute.save());

      // Add the delivery update promise to the array
      databaseUpdatePromises.push(
        Delivery.updateMany(
          { _id: { $in: deliveryIds } },
          { 
            $set: { status: 'assigned', assignedDriver: driverId },
            $push: { statusHistory: { status: 'assigned' } } 
          }
        )
      );
      
      // Add the driver update promise to the array
      databaseUpdatePromises.push(
        Driver.findByIdAndUpdate(driverId, { isAvailable: false })
      );
    }

    // Now, execute all the stored promises in parallel
    await Promise.all(databaseUpdatePromises);

    const io = req.app.get('socketio');
    io.emit('scheduleUpdated', { message: 'New routes have been generated!' });

    res.status(200).json({ success: true, routes: optimizedRoutes });
  } catch (error) {
    // Improved error logging
    if (error.code === 'ECONNREFUSED') {
        console.error('Error in generateSchedule: Connection to AI service was refused. Is the Python app running on port 5000?');
        return res.status(500).send('Server Error: Could not connect to the AI scheduling service.');
    }
    console.error('Error in generateSchedule:', error.response ? error.response.data : error.message);
    res.status(500).send('Server Error while generating schedule.');
  }
};
