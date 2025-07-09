// routes/deliveryRoutes.js
const express = require('express');
const router = express.Router();
const { createDelivery, getAllDeliveries, updateDeliveryStatus } = require('../controllers/deliveryController');

// Existing routes for getting all deliveries and creating a new one
router.route('/')
  .post(createDelivery)
  .get(getAllDeliveries);

// New route to update a specific delivery's status
router.put('/:deliveryId/status', updateDeliveryStatus);

module.exports = router;