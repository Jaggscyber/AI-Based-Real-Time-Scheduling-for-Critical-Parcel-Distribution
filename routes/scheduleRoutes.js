const express = require('express');
const router = express.Router();

const {
  generateSchedule,
  handleTrafficBlock,
  handleVehicleBreakdown,
  allocateDeliveryAutomatically,
} = require('../controllers/scheduleController');

// Generate full AI schedule for all pending deliveries
router.post('/', generateSchedule);

// Re‑optimize active routes when traffic blocks are reported
router.post('/traffic-block', handleTrafficBlock);

// Handle vehicle breakdown and reassign deliveries
router.post('/vehicle-breakdown', handleVehicleBreakdown);

// Auto‑assign a single new delivery to the best available driver
router.post('/allocate-delivery', allocateDeliveryAutomatically);

module.exports = router;
