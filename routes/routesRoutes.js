const express = require('express');
const router = express.Router();
const { 
    getDriverRoute, 
    getAllRoutes, 
    addStopToRoute, 
    recalculateRoute,
    getRouteLeg,
    getOrsDirections,
    getOrsGeocode
} = require('../controllers/routesController');

// ORS proxy endpoints (API key stays on server)
router.post('/directions', getOrsDirections);
router.get('/geocode', getOrsGeocode);

router.get('/', getAllRoutes);
router.get('/:driverId', getDriverRoute);
router.post('/add-stop', addStopToRoute);
router.post('/recalculate', recalculateRoute);
router.post('/leg', getRouteLeg);

module.exports = router;