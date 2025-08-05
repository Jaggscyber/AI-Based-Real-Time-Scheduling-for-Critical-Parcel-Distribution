// controllers/driverController.js
const Driver = require('../models/driverModel');

/**
 * @desc    Create a new driver
 * @route   POST /api/drivers
 */
exports.createDriver = async (req, res) => {
  try {
    const { name, isAvailable } = req.body;

    if (!name) {
      return res.status(400).json({ msg: 'Please provide a driver name' });
    }

    const newDriver = new Driver({
      name,
      isAvailable,
    });

    const driver = await newDriver.save();
    res.status(201).json(driver);

  } catch (err) {
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
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};


/**
 * @desc    Update a driver's location
 * @route   PUT /api/drivers/:driverId/location
 */
exports.updateDriverLocation = async (req, res) => {
  try {
    const { coordinates } = req.body;
    const io = req.app.get('socketio'); // Get the io instance

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({ msg: 'Please provide valid coordinates [longitude, latitude]' });
    }

    const updatedDriver = await Driver.findByIdAndUpdate(
      req.params.driverId,
      {
        currentLocation: {
          type: 'Point',
          coordinates: coordinates
        }
      },
      { new: true } // Return the updated document
    );

    if (!updatedDriver) {
      return res.status(404).json({ msg: 'Driver not found' });
    }

    // Emit an event with the updated driver location
    io.emit('driverLocationUpdated', updatedDriver);

    res.status(200).json(updatedDriver);

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};
