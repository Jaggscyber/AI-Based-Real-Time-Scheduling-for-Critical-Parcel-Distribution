// routes/driverRoutes.js
const express = require('express');
const router = express.Router();
const { createDriver, getAllDrivers, updateDriverLocation } = require('../controllers/driverController');

// Existing routes for getting all drivers and creating a new one
router.route('/')
  .get(getAllDrivers)
  .post(createDriver);

// New route to update a specific driver's location
router.put('/:driverId/location', updateDriverLocation);

module.exports = router;