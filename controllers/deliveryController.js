// controllers/deliveryController.js
const Delivery = require('../models/deliveryModel');

/**
 * @desc    Create a new delivery order
 * @route   POST /api/deliveries
 */
exports.createDelivery = async (req, res) => {
  try {
    const { pickupLocation, dropoffLocation, priority } = req.body;

    if (!pickupLocation || !dropoffLocation) {
      return res.status(400).json({ msg: 'Please provide pickup and dropoff locations' });
    }

    const newDelivery = new Delivery({
      pickupLocation,
      dropoffLocation,
      priority
    });

    const delivery = await newDelivery.save();
    res.status(201).json(delivery);

  } catch (err) {
    console.error('ERROR in createDelivery:', err.message);
    res.status(500).send('Server Error');
  }
};

/**
 * @desc    Get all delivery orders
 * @route   GET /api/deliveries
 */
exports.getAllDeliveries = async (req, res) => {
  try {
    const deliveries = await Delivery.find();
    res.status(200).json(deliveries);

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

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
