const Driver = require('../models/driverModel');
const Delivery = require('../models/deliveryModel');
const Route = require('../models/routeModel');

// A central constant for the warehouse location
const WAREHOUSE_LOCATION = {
    type: 'Point',
    coordinates: [80.2707, 13.0827] // [longitude, latitude] for Chennai
};

/**
 * @desc    Create a new driver and handle duplicates
 * @route   POST /api/drivers
 */
exports.createDriver = async (req, res) => {
  try {
    const { name, vehicleCapacity } = req.body;

    if (!name) {
      return res.status(400).json({ msg: 'Please provide a driver name' });
    }

    // This logic prevents the app from crashing on duplicate names
    const existingDriver = await Driver.findOne({ name });
    if (existingDriver) {
        return res.status(400).json({ msg: 'A driver with this name already exists.' });
    }

    const newDriver = new Driver({
      name,
      vehicleCapacity,
      isAvailable: true,
      currentLocation: WAREHOUSE_LOCATION // New drivers start at the warehouse
    });

    const driver = await newDriver.save();
    res.status(201).json(driver);

  } catch (err) {
    // This is a fallback for the unique constraint in the model
    if (err.code === 11000) {
        return res.status(400).json({ msg: 'A driver with this name already exists.' });
    }
    console.error('ERROR in createDriver:', err.message);
    res.status(500).send('Server Error');
  }
};

/**
 * @desc    Get all drivers
 * @route   GET /api/drivers
 */
exports.getAllDrivers = async (req, res) => {
  try {
    const drivers = await Driver.find();
    res.status(200).json(drivers);
  } catch (err) {
    console.error('Error in getAllDrivers:', err.message);
    res.status(500).send('Server Error');
  }
};

/**
 * @desc    Update a driver's real-time location
 * @route   PUT /api/drivers/:driverId/location
 */
exports.updateDriverLocation = async (req, res) => {
  try {
    const { coordinates } = req.body;
    const io = req.app.get('socketio');

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({ msg: 'Please provide valid coordinates [longitude, latitude]' });
    }

    const updatedDriver = await Driver.findByIdAndUpdate(
      req.params.driverId,
      {
        currentLocation: { type: 'Point', coordinates: coordinates }
      },
      { new: true }
    );

    if (!updatedDriver) {
      return res.status(404).json({ msg: 'Driver not found' });
    }

    io.emit('driverLocationUpdated', updatedDriver); // Notify frontend of the move
    res.status(200).json(updatedDriver);
  } catch (err) {
    console.error('Error in updateDriverLocation:', err.message);
    res.status(500).send('Server Error');
  }
};

/**
 * @desc    Get details for a driver, their active route, and history
 * @route   GET /api/drivers/:driverId/details
 */
exports.getDriverDetails = async (req, res) => {
    try {
        const driver = await Driver.findById(req.params.driverId);
        if (!driver) {
            return res.status(404).json({ msg: 'Driver not found' });
        }

        const activeRoute = await Route.findOne({ driver: req.params.driverId, status: { $ne: 'completed' } })
            .populate({ path: 'stops', model: 'Delivery' });

        const deliveryHistory = await Delivery.find({ assignedDriver: req.params.driverId, status: 'delivered' });

        res.status(200).json({
            driver,
            activeRoute,
            deliveryHistory,
            deliveriesCompleted: deliveryHistory.length
        });
    } catch (err) {
        console.error('Error in getDriverDetails:', err.message);
        res.status(500).send('Server Error');
    }
};

/**
 * @desc    Resets a driver to be available for a new schedule
 * @route   PUT /api/drivers/:driverId/reset
 */
exports.resetDriverStatus = async (req, res) => {
    try {
        const driver = await Driver.findByIdAndUpdate(
            req.params.driverId,
            {
                isAvailable: true,
                currentLocation: WAREHOUSE_LOCATION
            },
            { new: true }
        );

        if (!driver) {
            return res.status(404).json({ msg: 'Driver not found' });
        }

        const io = req.app.get('socketio');
        io.emit('driverLocationUpdated', driver); // Notify frontend of the status change
        res.status(200).json({ msg: 'Driver status has been reset.', driver });
    } catch (err) {
        console.error('Error resetting driver status:', err.message);
        res.status(500).send('Server Error');
    }
};

