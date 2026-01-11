const Delivery = require('../models/deliveryModel');
const Route = require('../models/routeModel');
const Driver = require('../models/driverModel');

// GET: Active deliveries
exports.getAllDeliveries = async (req, res) => {
    try {
        const deliveries = await Delivery.find({ 
            status: { $in: ['pending', 'assigned', 'in_transit'] } 
        }).populate('assignedDriver', 'name');
        res.status(200).json(deliveries);
    } catch (err){
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// GET: History
exports.getDeliveryHistory = async (req, res) => {
    try {
        const history = await Delivery.find({}) 
            .sort({ createdAt: -1 })
            .populate('assignedDriver', 'name');
        res.status(200).json(history);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// POST: Create
exports.createDelivery = async (req, res) => {
    try {
        // Destructure all expected fields
        const { 
            pickupLocation, 
            customerName, 
            customerPhone, 
            zone, 
            fullAddress, 
            items, 
            cost, 
            weight,    // <--- Added
            area,      // <--- Added
            size,      // <--- Added
            deadline,  // <--- Added
            emergency  // <--- Added
        } = req.body;
        
        // Basic Validation
        if (!pickupLocation || !customerName || !customerPhone) {
            return res.status(400).json({ msg: 'Missing required fields: Name, Phone, or Location.' });
        }

        const newDelivery = new Delivery({ 
            pickupLocation, 
            dropoffLocation: pickupLocation, // Defaulting dropoff to pickup for map demo
            customerName,
            customerPhone,
            fullAddress: fullAddress || 'N/A',
            zone: zone || 'Unzoned',
            items: items || [],
            cost: cost || 0,
            weight: weight || 5,      // Default 5kg
            area: area || 'urban',    // Default urban
            size: size || 'small',    // Default small
            deadline: deadline || 480, // Default 8 hours
            emergency: emergency || false
        });

        await newDelivery.save();

        const io = req.app.get('socketio');
        if(io) io.emit('scheduleUpdated', { message: `New delivery for ${customerName}.` });
        
        res.status(201).json(newDelivery);
    } catch (err) {
        console.error('Create Delivery Error:', err.message);
        res.status(500).send('Server Error');
    }
};

// PUT: Update Status
exports.updateDeliveryStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { deliveryId } = req.params;

    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) return res.status(404).json({ msg: 'Delivery not found' });

    // UPDATE FIELDS
    delivery.status = status;
    delivery.statusHistory.push({ status, timestamp: new Date() });
    
    if (['delivered', 'failed'].includes(status)) { 
        delivery.completedAt = new Date(); 
    }
    
    // CRITICAL FIX: If old data is missing required fields, fill them with placeholders
    // This prevents "Validation Error" on old test data
    if (!delivery.customerName) delivery.customerName = "Unknown Customer";
    if (!delivery.customerPhone) delivery.customerPhone = "000-000-0000";

    await delivery.save();
    
    const io = req.app.get('socketio');

    // Update Driver Location if delivered (Optional Logic)
    if (status === 'delivered' && delivery.assignedDriver) {
        const driver = await Driver.findByIdAndUpdate(
            delivery.assignedDriver, 
            { currentLocation: delivery.pickupLocation }, 
            { new: true }
        );
        if (driver && io) io.emit('driverLocationUpdated', driver);
    }

    if(io) io.emit('scheduleUpdated', { message: `Delivery updated: ${status}` });
    res.status(200).json(delivery);
  } catch (err) {
    console.error('Update Status Error:', err.message);
    res.status(500).send('Server Error: ' + err.message);
  }
};

// PUT: Assign (Manual Assignment)
exports.assignDelivery = async (req, res) => {
    try {
        const { deliveryId } = req.params;
        const { driverId } = req.body;
        
        const delivery = await Delivery.findById(deliveryId);
        const driver = await Driver.findById(driverId);

        if (!delivery || !driver) return res.status(404).json({ msg: 'Not found.' });
        
        delivery.status = 'assigned';
        delivery.assignedDriver = driverId;
        
        // Safety check for old data here too
        if (!delivery.customerName) delivery.customerName = "Unknown";
        if (!delivery.customerPhone) delivery.customerPhone = "000";

        await delivery.save();

        driver.isAvailable = false;
        await driver.save();

        // Add to route
        let route = await Route.findOne({ driver: driverId, status: { $ne: 'completed' } });
        if (route) {
            route.stops.push(deliveryId);
            await route.save();
        } else {
            route = new Route({ driver: driverId, stops: [deliveryId], status: 'assigned' });
            await route.save();
        }

        const io = req.app.get('socketio');
        if(io) io.emit('scheduleUpdated', { message: `Delivery assigned to ${driver.name}.` });
        
        res.status(200).json({ msg: 'Assigned successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// DELETE: Cascade Delete
exports.deleteDelivery = async (req, res) => {
    try {
        const { deliveryId } = req.params;
        const delivery = await Delivery.findById(deliveryId);
        
        if (!delivery) { return res.status(404).json({ msg: 'Delivery not found.' }); }
        
        // 1. If assigned, remove from Driver's Route first
        if (delivery.assignedDriver) {
            const driverId = delivery.assignedDriver;
            const route = await Route.findOne({ driver: driverId, status: { $ne: 'completed' } });
            
            if (route) {
                // Filter out this delivery ID from stops
                route.stops = route.stops.filter(id => id.toString() !== deliveryId);
                
                // If route is empty after deletion, remove route and free driver
                if (route.stops.length === 0) {
                    await Route.findByIdAndDelete(route._id);
                    await Driver.findByIdAndUpdate(driverId, { isAvailable: true });
                } else {
                    await route.save();
                }
            }
        }

        // 2. Delete the Delivery
        await delivery.deleteOne();
        
        const io = req.app.get('socketio');
        if(io) io.emit('scheduleUpdated', { message: `Delivery deleted.`});
        
        res.status(200).json({ msg: 'Delivery deleted successfully.' });
    } catch (err) {
        console.error('Delete Error:', err.message);
        res.status(500).send('Server Error');
    }
};
exports.trackOrder = async (req, res) => {
    try {
        const { trackingId } = req.params;
        let delivery;

        // Check if input is a valid MongoDB ID (24 chars)
        if (trackingId.match(/^[0-9a-fA-F]{24}$/)) {
            delivery = await Delivery.findById(trackingId).populate('assignedDriver', 'name phone currentLocation');
        } 
        // If not, try searching by Phone Number
        else {
            // Find the most recent active order for this phone number
            delivery = await Delivery.findOne({ customerPhone: trackingId })
                                     .sort({ createdAt: -1 }) // Get newest
                                     .populate('assignedDriver', 'name phone currentLocation');
        }

        if (!delivery) {
            return res.status(404).json({ msg: 'Order not found.' });
        }

        // ... (rest of your response construction code remains the same) ...
        const response = {
            id: delivery._id,
            status: delivery.status,
            items: delivery.items || ['Package'],
            customerName: delivery.customerName,
            pickupLocation: delivery.pickupLocation,
            dropoffLocation: delivery.dropoffLocation,
            eta: 'Calculating...', 
        };
        // ... (keep driver logic) ...

        res.status(200).json(response);
    } catch (err) {
        console.error('Tracking Error:', err.message);
        res.status(500).send('Server Error');
    }
};