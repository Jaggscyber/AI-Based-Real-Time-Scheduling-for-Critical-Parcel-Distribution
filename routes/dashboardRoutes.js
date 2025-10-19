const express = require('express');
const router = express.Router();
const { getWarehouseDetails } = require('../controllers/dashboardController');

// The only route in this file should be to GET details
router.get('/details', getWarehouseDetails);

module.exports = router;