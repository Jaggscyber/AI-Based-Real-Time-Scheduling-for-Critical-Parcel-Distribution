const Delivery = require('../models/deliveryModel');
const Route = require('../models/routeModel');
const Driver = require('../models/driverModel');
// NOTE: scheduleController is require'd lazily below to avoid circular-dependency issues at startup

// GET: Active deliveries
exports.getAllDeliveries = async (req, res) => {
    try {
        const deliveries = await Delivery.find({
            status: { $in: ['pending', 'assigned', 'in_transit'] }
        }).populate('assignedDriver', 'name');
        res.status(200).json(deliveries);
    } catch (err) {
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

        // --- Auto-allocate to the nearest available driver -------------------------
        let assignedDriverName = null;
        const io = req.app.get('socketio');
        try {
            const { autoAllocateDelivery } = require('./scheduleController');
            const result = await autoAllocateDelivery(newDelivery._id.toString(), io);
            assignedDriverName = result.driver.name;
        } catch (allocErr) {
            // No drivers available or AI unreachable — leave delivery as pending
            console.warn('Auto-allocate skipped:', allocErr.message);
            // Still emit a generic update so admin can see the new pending delivery
            if (io) io.emit('scheduleUpdated', { message: `New delivery for ${customerName}. Awaiting driver assignment.` });
        }
        // ---------------------------------------------------------------------------

        res.status(201).json({ ...newDelivery.toObject(), assignedDriverName });
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

        if (io) io.emit('scheduleUpdated', { message: `Delivery updated: ${status}` });
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
        if (io) io.emit('scheduleUpdated', { message: `Delivery assigned to ${driver.name}.` });

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
        if (io) io.emit('scheduleUpdated', { message: `Delivery deleted.` });

        res.status(200).json({ msg: 'Delivery deleted successfully.' });
    } catch (err) {
        console.error('Delete Error:', err.message);
        res.status(500).send('Server Error');
    }
};
// ─── WAREHOUSE DEMO: Batch simulate N deliveries arriving at warehouse ────────
// Chennai-area bounding box for random coords
const CHENNAI_BOUNDS = {
    latMin: 12.90, latMax: 13.20,
    lngMin: 80.10, lngMax: 80.35
};
const SAMPLE_NAMES = ['Raj', 'Priya', 'Kumar', 'Anita', 'Suresh', 'Meera', 'Arjun', 'Lakshmi', 'Vijay', 'Divya', 'Muhammed', 'Sita', 'Karthik', 'Nisha', 'Ravi', 'Pooja', 'Deepak', 'Revathi', 'Sanjay', 'Bharathi'];
const SAMPLE_ADDR = ['Anna Nagar', 'T Nagar', 'Adyar', 'Velachery', 'Porur', 'Tambaram', 'Chromepet', 'Mylapore', 'Kodambakkam', 'Pallavaram'];

exports.simulateBatchDeliveries = async (req, res) => {
    try {
        const count = Math.min(Math.max(parseInt(req.body.count) || 50, 1), 100);
        const io = req.app.get('socketio');

        const created = [];
        for (let i = 0; i < count; i++) {
            const lat = CHENNAI_BOUNDS.latMin + Math.random() * (CHENNAI_BOUNDS.latMax - CHENNAI_BOUNDS.latMin);
            const lng = CHENNAI_BOUNDS.lngMin + Math.random() * (CHENNAI_BOUNDS.lngMax - CHENNAI_BOUNDS.lngMin);
            const name = SAMPLE_NAMES[i % SAMPLE_NAMES.length] + ' ' + (Math.floor(Math.random() * 99) + 1);
            const addr = SAMPLE_ADDR[i % SAMPLE_ADDR.length];
            const sizes = ['small', 'medium', 'large'];
            const size = sizes[Math.floor(Math.random() * sizes.length)];

            const delivery = new Delivery({
                customerName: name,
                customerPhone: `98${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`,
                fullAddress: `${Math.floor(Math.random() * 999) + 1}, ${addr}, Chennai`,
                pickupLocation: { type: 'Point', coordinates: [lng, lat] },
                dropoffLocation: { type: 'Point', coordinates: [lng, lat] },
                zone: 'Unzoned',
                area: 'urban',
                weight: Math.round((Math.random() * 14 + 1) * 10) / 10,
                size,
                deadline: 480,
                emergency: Math.random() < 0.05,
                status: 'pending'
            });
            await delivery.save();
            created.push(delivery);
        }

        if (io) io.emit('batchDeliveryArrived', { count: created.length, message: `📦 ${created.length} packages arrived at warehouse!`, deliveries: created });

        res.status(201).json({ success: true, count: created.length, deliveries: created });
    } catch (err) {
        console.error('simulateBatchDeliveries error:', err.message);
        res.status(500).send('Server Error');
    }
};
// ─────────────────────────────────────────────────────────────────────────────

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
            otp: delivery.otp,                  // send OTP to customer view
            otpVerified: delivery.otpVerified,
            statusHistory: delivery.statusHistory || [],
            createdAt: delivery.createdAt,
        };
        // ... (keep driver logic) ..
        if (delivery.assignedDriver) {
            response.driverName = delivery.assignedDriver.name;
            response.driverPhone = delivery.assignedDriver.phone;
            response.driverLocation = delivery.assignedDriver.currentLocation;
            response.assignedDriver = delivery.assignedDriver._id;
        }

        res.status(200).json(response);
    } catch (err) {
        console.error('Tracking Error:', err.message);
        res.status(500).send('Server Error');
    }
};

// POST: Generate OTP for customer
exports.generateOTP = async (req, res) => {
    try {
        const { deliveryId } = req.params;
        const delivery = await Delivery.findById(deliveryId);
        if (!delivery) return res.status(404).json({ msg: 'Delivery not found.' });

        // Idempotent: if OTP already exists and not verified, reuse it
        if (!delivery.otp || delivery.otpVerified) {
            delivery.otp = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit
            delivery.otpVerified = false;
        }
        await delivery.save();

        const io = req.app.get('socketio');
        if (io) {
            // Emit OTP to customer room if using rooms, else broadcast
            io.emit('otpGenerated', { deliveryId, otp: delivery.otp, customerName: delivery.customerName });
        }

        res.status(200).json({ otp: delivery.otp, deliveryId });
    } catch (err) {
        console.error('Generate OTP Error:', err.message);
        res.status(500).send('Server Error');
    }
};

// GET: Customer's own orders by phone
exports.getMyOrders = async (req, res) => {
    try {
        const { phone, email } = req.query;
        if (!phone && !email) {
            return res.status(400).json({ msg: 'phone or email query param required' });
        }
        const query = {};
        if (phone) query.customerPhone = phone.trim();
        // email lookup not in delivery model — skip unless added in future

        const deliveries = await Delivery.find(query)
            .sort({ createdAt: -1 })
            .populate('assignedDriver', 'name phone currentLocation');

        const formatted = deliveries.map(d => ({
            id: d._id,
            status: d.status,
            customerName: d.customerName,
            customerPhone: d.customerPhone,
            fullAddress: d.fullAddress,
            items: d.items || ['Package'],
            weight: d.weight,
            emergency: d.emergency,
            otp: d.otp,
            otpVerified: d.otpVerified,
            createdAt: d.createdAt,
            completedAt: d.completedAt,
            statusHistory: d.statusHistory || [],
            pickupLocation: d.pickupLocation,
            driverName: d.assignedDriver?.name || null,
            driverPhone: d.assignedDriver?.phone || null,
            driverLocation: d.assignedDriver?.currentLocation || null,
        }));

        res.status(200).json(formatted);
    } catch (err) {
        console.error('getMyOrders Error:', err.message);
        res.status(500).send('Server Error');
    }
};

// POST: Verify OTP entered by driver
exports.verifyOTP = async (req, res) => {
    try {
        const { deliveryId } = req.params;
        const { otp } = req.body;

        const delivery = await Delivery.findById(deliveryId);
        if (!delivery) return res.status(404).json({ msg: 'Delivery not found.' });

        if (!delivery.otp) {
            return res.status(400).json({ msg: 'No OTP generated for this delivery.' });
        }

        if (String(otp).trim() !== String(delivery.otp).trim()) {
            return res.status(400).json({ msg: 'Incorrect OTP. Ask the customer for the correct code.' });
        }

        // OTP matched — mark delivered
        delivery.otpVerified = true;
        delivery.status = 'delivered';
        delivery.completedAt = new Date();
        delivery.statusHistory.push({ status: 'delivered', timestamp: new Date() });

        if (!delivery.customerName) delivery.customerName = 'Unknown Customer';
        if (!delivery.customerPhone) delivery.customerPhone = '000-000-0000';
        await delivery.save();

        const io = req.app.get('socketio');
        if (io) io.emit('scheduleUpdated', { message: `✅ OTP verified — ${delivery.customerName}'s delivery confirmed!` });

        res.status(200).json({ msg: 'OTP verified. Delivery marked as delivered.', delivery });
    } catch (err) {
        console.error('Verify OTP Error:', err.message);
        res.status(500).send('Server Error');
    }
};