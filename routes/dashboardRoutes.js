const express = require('express');
const router = express.Router();
const { getWarehouseDetails, getDriverPerformance, checkSLABreaches } = require('../controllers/dashboardController');

router.get('/details', getWarehouseDetails);
router.get('/driver-performance', getDriverPerformance);
router.get('/sla-breaches', checkSLABreaches);

module.exports = router;
