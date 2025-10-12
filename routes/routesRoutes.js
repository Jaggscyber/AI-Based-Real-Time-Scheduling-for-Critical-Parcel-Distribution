const express = require('express');
const router = express.Router();
const { getDriverRoute, getAllRoutes, addStopToRoute } = require('../controllers/routesController');

router.get('/', getAllRoutes);
router.get('/:driverId', getDriverRoute);
router.post('/add-stop', addStopToRoute);

module.exports = router;