// controllers/routesController.js
const Route = require('../models/routeModel');

/**
 * @desc    Get the assigned route for a specific driver
 * @route   GET /api/routes/:driverId
 */
exports.getDriverRoute = async (req, res) => {
  try {
    // Find the most recent route for the given driver that is not yet completed
    const route = await Route.findOne({
      driver: req.params.driverId,
      status: { $ne: 'completed' } // $ne means "not equal"
    })
    .sort({ createdAt: -1 }) // Get the latest one
    .populate('stops'); // IMPORTANT: This replaces the delivery IDs with the full delivery objects

    if (!route) {
      return res.status(404).json({ msg: 'No active route found for this driver.' });
    }

    res.status(200).json(route);

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};
