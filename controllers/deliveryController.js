const Delivery = require('../models/deliveryModel');
const Route = require('../models/routeModel');
const Driver = require('../models/driverModel');
const { recalculateRouteForDriver } = require('../utils/routeOptimizer');

// Gets only ACTIVE deliveries for the main dashboard view
exports.getAllDeliveries = async (req, res) => {
    try {
        const deliveries = await Delivery.find({ 
            status: { $in: ['pending', 'assigned', 'in_transit'] } 
        }).populate('assignedDriver', 'name');
        res.status(200).json(deliveries);
    } catch (err){
        res.status(500).send('Server Error');
    }
};

// Gets completed/failed deliveries for the history table
exports.getDeliveryHistory = async (req, res) => {
    try {
        const history = await Delivery.find({ status: { $in: ['delivered', 'failed'] } })
            .sort({ completedAt: -1 })
            .populate('assignedDriver', 'name');
        res.status(200).json(history);
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.createDelivery = async (req, res) => {
    try {
        const { pickupLocation } = req.body;
        const newDelivery = new Delivery({ pickupLocation, dropoffLocation: pickupLocation });
        await newDelivery.save();
        const io = req.app.get('socketio');
        io.emit('scheduleUpdated', { message: 'New delivery created.' });
        res.status(201).json(newDelivery);
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.updateDeliveryStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { deliveryId } = req.params;
    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) { return res.status(404).json({ msg: 'Delivery not found' }); }

    delivery.status = status;
    delivery.statusHistory.push({ status, timestamp: new Date() });
    if (status === 'delivered' || status === 'failed') { delivery.completedAt = new Date(); }
    await delivery.save();
    
    const io = req.app.get('socketio');
    
    // THIS IS THE FIX: Convert the ID to a string before slicing it
    const message = `Delivery ${delivery._id.toString().slice(-6)} status: ${status}.`;
    io.emit('scheduleUpdated', { message });

    if (status === 'delivered' && delivery.assignedDriver) {
        const driver = await Driver.findByIdAndUpdate(delivery.assignedDriver, { currentLocation: delivery.pickupLocation }, { new: true });
        if (driver) io.emit('driverLocationUpdated', driver);
        await recalculateRouteForDriver(delivery.assignedDriver.toString());
    }
    res.status(200).json(delivery);
  } catch (err) {
    // This console.error will now correctly log the error without crashing
    console.error('Error updating delivery status:', err.message);
    res.status(500).send('Server Error');
  }
};
exports.assignDelivery = async (req, res) => {
    try {
        const { deliveryId } = req.params;
        const { driverId } = req.body;
        const delivery = await Delivery.findById(deliveryId);
        const driver = await Driver.findById(driverId);
        if (!delivery || !driver) { return res.status(404).json({ msg: 'Delivery or Driver not found.' }); }
        if (delivery.status !== 'pending') { return res.status(400).json({ msg: 'Delivery is not pending.' }); }
        if (!driver.isAvailable) { return res.status(400).json({ msg: 'Driver is not available.' }); }

        delivery.status = 'assigned';
        delivery.assignedDriver = driverId;
        await delivery.save();
        driver.isAvailable = false;
        await driver.save();
        
        let route = await Route.findOne({ driver: driverId, status: { $ne: 'completed' } });
        if (route) { route.stops.push(deliveryId); await route.save(); }
        else { route = new Route({ driver: driverId, stops: [deliveryId], status: 'assigned' }); await route.save(); }
        
        await recalculateRouteForDriver(driverId);
        const io = req.app.get('socketio');
        io.emit('scheduleUpdated', { message: `Delivery assigned to ${driver.name}.` });
        res.status(200).json({ msg: 'Delivery assigned successfully.' });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.unassignDelivery = async (req, res) => {
    try {
        const { deliveryId } = req.params;
        const delivery = await Delivery.findById(deliveryId);
        if (!delivery || !delivery.assignedDriver) { return res.status(404).json({ msg: 'Assigned delivery not found.' }); }
        const driverId = delivery.assignedDriver.toString();
        delivery.status = 'pending';
        delivery.assignedDriver = null;
        await delivery.save();
        await Route.updateOne({ driver: driverId }, { $pull: { stops: deliveryId } });
        await recalculateRouteForDriver(driverId);
        const io = req.app.get('socketio');
        io.emit('scheduleUpdated', { message: `Delivery unassigned.` });
        res.status(200).json({ msg: 'Delivery unassigned successfully.' });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.deleteDelivery = async (req, res) => {
    try {
        const { deliveryId } = req.params;
        const delivery = await Delivery.findById(deliveryId);
        if (!delivery) { return res.status(404).json({ msg: 'Delivery not found.' }); }
        if (['assigned', 'in_transit'].includes(delivery.status)) { return res.status(400).json({ msg: 'Cannot delete an active delivery.' }); }
        await delivery.deleteOne();
        const io = req.app.get('socketio');
        io.emit('scheduleUpdated', { message: `Delivery deleted.`});
        res.status(200).json({ msg: 'Delivery deleted successfully.' });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};