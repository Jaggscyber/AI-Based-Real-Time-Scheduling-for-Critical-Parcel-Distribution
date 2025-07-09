// controllers/deliveryController.js
const Delivery = require('../models/deliveryModel');

// ... (keep createDelivery and getAllDeliveries functions as they are) ...
exports.createDelivery = async (req, res) => { /* ... no changes ... */ };
exports.getAllDeliveries = async (req, res) => { /* ... no changes ... */ };


/**
 * @desc    Update the status of a delivery
 * @route   PUT /api/deliveries/:deliveryId/status
 */
exports.updateDeliveryStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const io = req.app.get('socketio'); // Get the io instance

    const allowedStatuses = ['pending', 'assigned', 'in_transit', 'delivered', 'failed'];
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ msg: 'Invalid status provided' });
    }

    const updatedDelivery = await Delivery.findByIdAndUpdate(
      req.params.deliveryId,
      { status: status },
      { new: true }
    );

    if (!updatedDelivery) {
      return res.status(404).json({ msg: 'Delivery not found' });
    }

    // Emit an event with the updated delivery status
    io.emit('deliveryStatusUpdated', updatedDelivery);

    res.status(200).json(updatedDelivery);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};