const express = require('express');
const router = express.Router();
const { getDriverRoute, getAllRoutes, addStopToRoute, recalculateRoute } = require('../controllers/routesController');

router.get('/', getAllRoutes);
router.get('/:driverId', getDriverRoute);
router.post('/add-stop', addStopToRoute);
router.post('/recalculate', recalculateRoute);

module.exports = router;