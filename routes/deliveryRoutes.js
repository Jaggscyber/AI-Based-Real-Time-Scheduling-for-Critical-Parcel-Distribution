const express = require('express');
const router = express.Router();
const {
    createDelivery,
    getAllDeliveries,
    updateDeliveryStatus,
    getDeliveryHistory, 
    deleteDelivery,
    trackOrder // <--- Import this new function
} = require('../controllers/deliveryController');

router.post('/', createDelivery);
router.get('/', getAllDeliveries);
router.put('/:deliveryId/status', updateDeliveryStatus);
router.delete('/:deliveryId', deleteDelivery);
router.get('/history', getDeliveryHistory);

// NEW TRACKING ROUTE
router.get('/track/:trackingId', trackOrder);

module.exports = router;