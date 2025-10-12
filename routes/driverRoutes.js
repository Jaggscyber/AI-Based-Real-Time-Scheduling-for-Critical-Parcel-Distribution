const express = require('express');
const router = express.Router();
const { 
    getAllDrivers, 
    updateDriverLocation, 
    getDriverDetails 
} = require('../controllers/driverController');

router.route('/')
  .get(getAllDrivers);

router.put('/:driverId/location', updateDriverLocation);

router.get('/:driverId/details', getDriverDetails);

module.exports = router;