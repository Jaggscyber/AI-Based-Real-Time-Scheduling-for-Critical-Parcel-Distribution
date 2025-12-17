const express = require('express');
const router = express.Router();
const {
    getAllDrivers,
    getDriverDetails,
    resetAllDrivers,
    returnToWarehouse,
    assignZoneToDriver,
    registerDriver
} = require('../controllers/driverController');

// Route to register a new driver (Auth + Profile)
router.post('/register', registerDriver);

// Route to get a list of all drivers
router.get('/', getAllDrivers);

// Route to get detailed information for a single driver
router.get('/:driverId/details', getDriverDetails);

// Route to reset all drivers to their default state
router.post('/reset-all', resetAllDrivers);

// Route to handle a driver completing their route and returning to the warehouse
router.post('/:driverId/return-to-warehouse', returnToWarehouse);

// Route to update a driver's assigned zone
router.put('/:driverId/assign-zone', assignZoneToDriver);

module.exports = router;