const Delivery = require('../models/deliveryModel');
const Route = require('../models/routeModel');
const Driver = require('../models/driverModel');

// A central constant for the warehouse location to reset drivers
const WAREHOUSE_LOCATION = {
    type: 'Point',
    coordinates: [80.2707, 13.0827] // [longitude, latitude] for Chennai
};

/**
 * @desc    Create a new delivery
 * @route   POST /api/deliveries
 */
exports.createDelivery = async (req, res) => {
    try {
        const { pickupLocation, dropoffLocation, size } = req.body;
        if (!pickupLocation || !dropoffLocation) {
            return res.status(400).json({ msg: 'Please provide both pickup and dropoff locations' });
        }
        const newDelivery = new Delivery({ pickupLocation, dropoffLocation, size });
        const delivery = await newDelivery.save();
        const io = req.app.get('socketio');
        io.emit('deliveryStatusUpdated', delivery);
        res.status(201).json(delivery);
    } catch (err) {
        console.error('Error in createDelivery:', err.message);
        res.status(500).send('Server Error');
    }
};

/**
 * @desc    Get all deliveries
 * @route   GET /api/deliveries
 */
exports.getAllDeliveries = async (req, res) => {
    try {
        const deliveries = await Delivery.find();
        res.status(200).json(deliveries);
    } catch (err){
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

/**
 * @desc    Update a delivery's status and trigger driver reset on route completion
 * @route   PUT /api/deliveries/:deliveryId/status
 */
exports.updateDeliveryStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { deliveryId } = req.params;
    const allowedStatuses = ['pending', 'assigned', 'in_transit', 'delivered', 'failed'];
    if (!status || !allowedStatuses.includes(status)) {
        return res.status(400).json({ msg: 'Invalid status provided' });
    }
    const updatedDelivery = await Delivery.findByIdAndUpdate(
      deliveryId,
      { 
          $set: { status: status },
          $push: { statusHistory: { status: status, timestamp: new Date() } }
      },
      { new: true }
    );
    if (!updatedDelivery) {
      return res.status(404).json({ msg: 'Delivery not found' });
    }
    
    const io = req.app.get('socketio');
    io.emit('deliveryStatusUpdated', updatedDelivery);

    // --- FIX: AUTOMATIC DRIVER AND ROUTE COMPLETION LOGIC ---
    if (status === 'delivered' && updatedDelivery.assignedDriver) {
        const route = await Route.findOne({ stops: deliveryId }).populate('stops');
        if (route) {
            const allStopsDelivered = route.stops.every(stop => stop.status === 'delivered');
            if (allStopsDelivered) {
                route.status = 'completed';
                await route.save();

                // Reset the driver directly to be available again at the warehouse
                const driver = await Driver.findByIdAndUpdate(route.driver, {
                    isAvailable: true,
                    currentLocation: WAREHOUSE_LOCATION
                }, { new: true });
                
                io.emit('scheduleUpdated', { message: `Route for driver ${driver.name} completed.` });
                io.emit('driverLocationUpdated', driver);
            }
        }
    }
    // --- END OF FIX ---

    res.status(200).json(updatedDelivery);
  } catch (err) {
    console.error('Error updating delivery status:', err.message);
    res.status(500).send('Server Error');
  }
};

