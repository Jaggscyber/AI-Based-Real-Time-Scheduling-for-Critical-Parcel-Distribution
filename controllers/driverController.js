// controllers/driverController.js
const Driver = require('../models/driverModel');

// ... (keep createDriver and getAllDrivers functions as they are) ...

exports.createDriver = async (req, res) => { /* ... no changes ... */ };
exports.getAllDrivers = async (req, res) => { /* ... no changes ... */ };

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