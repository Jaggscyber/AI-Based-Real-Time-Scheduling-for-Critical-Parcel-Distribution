// routes/routesRoutes.js
const express = require('express');
const router = express.Router();
const { getDriverRoute } = require('../controllers/routesController');

// Get the active route for a specific driver
router.get('/:driverId', getDriverRoute);

module.exports = router;
