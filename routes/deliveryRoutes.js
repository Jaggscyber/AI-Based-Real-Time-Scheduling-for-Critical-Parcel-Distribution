const express = require('express');
const router = express.Router();
const {
    createDelivery,
    getAllDeliveries,
    updateDeliveryStatus,
    getDeliveryHistory,
    deleteDelivery,
    trackOrder,
    simulateBatchDeliveries,
    generateOTP,
    verifyOTP,
    getMyOrders
} = require('../controllers/deliveryController');

router.post('/', createDelivery);
router.get('/', getAllDeliveries);
router.put('/:deliveryId/status', updateDeliveryStatus);
router.delete('/:deliveryId', deleteDelivery);
router.get('/history', getDeliveryHistory);

// Customer: fetch my orders by phone number
router.get('/my-orders', getMyOrders);

// Tracking route
router.get('/track/:trackingId', trackOrder);

// Warehouse demo
router.post('/simulate-batch', simulateBatchDeliveries);

// OTP verification
router.post('/:deliveryId/generate-otp', generateOTP);
router.post('/:deliveryId/verify-otp', verifyOTP);

module.exports = router;
