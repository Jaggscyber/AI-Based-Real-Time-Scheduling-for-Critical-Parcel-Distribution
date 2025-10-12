const mongoose = require('mongoose');
const Route = require('../models/routeModel');
const Driver = require('../models/driverModel'); // <-- Import Driver model

/**
 * @desc    Get the active route for a driver, or just their details if no route is active.
 * @route   GET /api/routes/:driverId
 */
exports.getDriverRoute = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.driverId)) {
      return res.status(400).json({ msg: 'Invalid Driver ID format.' });
    }

    // First, try to find an active route
    let route = await Route.findOne({
      driver: req.params.driverId,
      status: { $ne: 'completed' }
    })
    .populate('driver', 'name currentLocation')
    .populate({ path: 'stops', model: 'Delivery' });

    // --- FIX: If no active route is found, return driver details with an empty route ---
    if (!route) {
        const driver = await Driver.findById(req.params.driverId).select('name currentLocation');
        if (!driver) {
            // Only send 404 if the driver truly doesn't exist
            return res.status(404).json({ msg: 'Driver not found.' });
        }
        // If driver exists but has no active route, send a successful response
        return res.status(200).json({
            driver: driver,
            stops: [], // Empty stops array
            status: 'inactive',
            polyline: null,
            totalDistance: 'N/A',
            totalDuration: 'N/A',
            legs: []
        });
    }
    // --- END OF FIX ---

    res.status(200).json(route);
  } catch (error) {
    console.error('Error fetching driver route:', error.message);
    res.status(500).send('Server Error');
  }
};

/**
 * @desc    Get all active routes for the admin dashboard
 * @route   GET /api/routes
 */
exports.getAllRoutes = async (req, res) => {
  try {
    const routes = await Route.find({ status: { $ne: 'completed' } })
      .populate('driver', 'name currentLocation')
      .populate('stops');
    res.status(200).json(routes);
  } catch (error) {
    console.error('Error fetching all routes:', error.message);
    res.status(500).send('Server Error');
  }
};

/**
 * @desc    Dynamically add a stop to an existing route
 * @route   POST /api/routes/add-stop
 */
exports.addStopToRoute = async (req, res) => {
    const { driverId, deliveryId } = req.body;
    try {
        if (!mongoose.Types.ObjectId.isValid(driverId) || !mongoose.Types.ObjectId.isValid(deliveryId)) {
            return res.status(400).json({ msg: 'Invalid ID format provided.' });
        }
        let route = await Route.findOne({ driver: driverId, status: { $in: ['pending', 'in_progress'] } });
        const delivery = await Delivery.findById(deliveryId);

        if (!delivery || delivery.status !== 'pending') {
            return res.status(400).json({ msg: 'This delivery is not pending and cannot be assigned.' });
        }

        if (route) {
            route.stops.push(deliveryId);
            await route.save();
        } else {
            route = new Route({
                driver: driverId,
                stops: [deliveryId],
                status: 'pending',
            });
            await route.save();
        }

        delivery.status = 'assigned';
        delivery.assignedDriver = driverId;
        await delivery.save();
        
        const io = req.app.get('socketio');
        io.emit('scheduleUpdated', { message: `New delivery assigned to driver ${driverId}` });

        res.status(200).json(route);
    } catch (err) {
        console.error('Error adding stop to route:', err.message);
        res.status(500).send('Server Error');
    }
};

