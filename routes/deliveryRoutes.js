const express = require('express');
const router = express.Router();
const {
    createDelivery,
    getAllDeliveries,
    updateDeliveryStatus,
    getDeliveryHistory, 
    deleteDelivery
} = require('../controllers/deliveryController');

// 1. Static Routes (MUST BE FIRST)
router.get('/history', getDeliveryHistory); 
router.get('/', getAllDeliveries);
router.post('/', createDelivery);

// 2. Dynamic Routes (/:id)
router.put('/:deliveryId/status', updateDeliveryStatus);
router.delete('/:deliveryId', deleteDelivery);

module.exports = router;