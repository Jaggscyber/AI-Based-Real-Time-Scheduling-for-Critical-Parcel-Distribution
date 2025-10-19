const express = require('express');
const router = express.Router();
const {
    getAllDrivers,
    getDriverDetails,
    resetAllDrivers,
    returnToWarehouse
} = require('../controllers/driverController');


router.get('/', getAllDrivers);
router.get('/:driverId/details', getDriverDetails);
router.post('/reset-all', resetAllDrivers);
router.post('/:driverId/return-to-warehouse', returnToWarehouse);

module.exports = router;