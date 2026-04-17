const express = require('express');
const router = express.Router();
const {
    getAllDrivers,
    getDriverLocations,
    getDriverDetails,
    resetAllDrivers,
    returnToWarehouse,
    assignZoneToDriver,
    registerDriver,
    updateLocationAndFuel,
    updateLocationOnly,
    refuelDriver,
    drainFuel
} = require('../controllers/driverController');

// Route to register a new driver (Auth + Profile)
router.post('/register', registerDriver);

// Lightweight location list for 30s admin polling
router.get('/locations', getDriverLocations);

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

// 30-second heartbeat (location only, no fuel recalc)
router.post('/:driverId/location', updateLocationOnly);

// Update driver location and compute fuel consumption; returns nearby fuel stations when low
router.post('/:driverId/update-location', updateLocationAndFuel);

// Refuel a driver back to 100%
router.post('/:driverId/refuel', refuelDriver);

// Drain fuel by a fixed amount (time-based simulation from admin)
router.post('/:driverId/drain-fuel', drainFuel);

module.exports = router;
