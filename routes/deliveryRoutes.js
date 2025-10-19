const express = require('express');
const router = express.Router();
const {
    createDelivery,
    getAllDeliveries,
    updateDeliveryStatus,
    getDeliveryHistory, // <-- Added
    deleteDelivery
} = require('../controllers/deliveryController');

router.post('/', createDelivery);
router.get('/', getAllDeliveries);
router.put('/:deliveryId/status', updateDeliveryStatus);
router.delete('/:deliveryId', deleteDelivery);
router.get('/history', getDeliveryHistory); // <-- Added

module.exports = router;