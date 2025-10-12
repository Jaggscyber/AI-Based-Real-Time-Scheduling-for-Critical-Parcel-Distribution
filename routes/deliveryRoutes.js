const express = require('express');
const router = express.Router();
const { createDelivery, getAllDeliveries, updateDeliveryStatus } = require('../controllers/deliveryController');

router.route('/')
  .post(createDelivery)
  .get(getAllDeliveries);

router.put('/:deliveryId/status', updateDeliveryStatus);

module.exports = router;