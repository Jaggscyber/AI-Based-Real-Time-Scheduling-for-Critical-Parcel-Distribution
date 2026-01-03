const express = require('express');
const router = express.Router();
const { 
    getDriverRoute, 
    getAllRoutes, 
    addStopToRoute, 
    recalculateRoute,
    getRouteLeg // <--- Import new function
} = require('../controllers/routesController');

router.get('/', getAllRoutes);
router.get('/:driverId', getDriverRoute);
router.post('/add-stop', addStopToRoute);
router.post('/recalculate', recalculateRoute);

// New Endpoint for "Focus Mode"
router.post('/leg', getRouteLeg); 

module.exports = router;