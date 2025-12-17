const Driver = require('../models/driverModel');
const Delivery = require('../models/deliveryModel');
const Route = require('../models/routeModel');
const User = require('../models/userModel');
const bcrypt = require('bcryptjs');

// Hardcoded Warehouse Location for Reset (Chennai)
const WAREHOUSE_LOCATION = { type: 'Point', coordinates: [80.2707, 13.0827] }; 

// --- 1. REGISTER DRIVER (Self-Healing) ---
exports.registerDriver = async (req, res) => {
    console.log("📝 Registering:", req.body.email);
    try {
        const { name, email, password, phone, vehicleType, license } = req.body;
        const normalizedEmail = email.toLowerCase().trim();

        // Check if User (Login) exists
        let user = await User.findOne({ email: normalizedEmail });
        
        if (user) {
            console.log("User exists, checking for Driver Profile...");
            // Check if Driver Profile exists
            const existingDriver = await Driver.findOne({ email: normalizedEmail });
            
            if (existingDriver) {
                return res.status(400).json({ msg: 'Account exists. Please Login.' });
            } else {
                console.log("⚠️ User exists but Driver Profile missing. Fixing now...");
                // Proceed to create Driver below
            }
        } else {
            // Create New User
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            user = new User({
                name,
                email: normalizedEmail,
                password: hashedPassword,
                role: 'driver',
                phone: phone || 'N/A',
                address: 'Registered Driver'
            });
            await user.save();
            console.log("✅ User Created");
        }

        // Create Driver Profile (if missing)
        let driver = await Driver.findOne({ email: normalizedEmail });
        if (!driver) {
            driver = new Driver({
                name,
                email: normalizedEmail,
                currentLocation: WAREHOUSE_LOCATION,
                assignedZone: 'Unzoned',
                isAvailable: true,
                vehicleType: vehicleType || 'Bike',
                license: license || 'N/A'
            });
            await driver.save();
            console.log("✅ Driver Profile Created");
        }

        res.status(201).json({ msg: 'Registration Successful! Please Login.' });

    } catch (err) {
        console.error('❌ Register Error:', err.message);
        res.status(500).send('Server Error: ' + err.message);
    }
};

// --- 2. GET ALL DRIVERS ---
exports.getAllDrivers = async (req, res) => {
    try {
        // Ensure every driver has valid location before sending to map
        let drivers = await Driver.find({}).lean();
        drivers = drivers.map(d => {
            if(!d.currentLocation || !d.currentLocation.coordinates || d.currentLocation.coordinates.length !== 2) {
                d.currentLocation = WAREHOUSE_LOCATION;
            }
            return d;
        });
        res.status(200).json(drivers);
    } catch (err) {
        console.error('Error fetching drivers:', err.message);
        res.status(500).send('Server Error');
    }
};

// --- 3. GET SINGLE DRIVER DETAILS ---
exports.getDriverDetails = async (req, res) => {
    try {
        const { driverId } = req.params;
        const driver = await Driver.findById(driverId);
        if (!driver) return res.status(404).json({ msg: 'Driver not found' });

        // Find active route (not completed)
        const activeRoute = await Route.findOne({ driver: driverId, status: { $ne: 'completed' } }).populate('stops');
        
        res.status(200).json({ driver, activeRoute });
    } catch (err) {
        console.error('Error fetching driver details:', err.message);
        res.status(500).send('Server Error');
    }
};

// --- 4. ASSIGN ZONE ---
exports.assignZoneToDriver = async (req, res) => {
    try {
        const { driverId } = req.params;
        const { zone } = req.body;

        const driver = await Driver.findByIdAndUpdate(driverId, { assignedZone: zone }, { new: true });
        if (!driver) return res.status(404).json({ msg: 'Driver not found' });

        const io = req.app.get('socketio');
        if(io) io.emit('scheduleUpdated', { message: `Zone assigned to ${driver.name}` });

        res.status(200).json(driver);
    } catch (err) {
        console.error('Error assigning zone:', err.message);
        res.status(500).send('Server Error');
    }
};

// --- 5. RETURN TO WAREHOUSE ---
exports.returnToWarehouse = async (req, res) => {
    try {
        const { driverId } = req.params;
        const driver = await Driver.findByIdAndUpdate(
            driverId, 
            { isAvailable: true, currentLocation: WAREHOUSE_LOCATION }, 
            { new: true }
        );
        if (!driver) return res.status(404).json({ msg: 'Driver not found' });

        // Mark active routes as completed
        await Route.updateMany({ driver: driverId, status: { $ne: 'completed' } }, { status: 'completed' });

        const io = req.app.get('socketio');
        if(io) {
            io.emit('driverLocationUpdated', driver);
            io.emit('scheduleUpdated', { message: `${driver.name} returned to warehouse.` });
        }
        res.status(200).json(driver);
    } catch (err) {
        console.error('Error returning to warehouse:', err.message);
        res.status(500).send('Server Error');
    }
};

// --- 6. SYSTEM RESET (EMERGENCY) ---
exports.resetAllDrivers = async (req, res) => {
    try {
        console.log("♻️ System Reset Initiated");

        // Reset Drivers
        await Driver.updateMany({}, { 
            $set: {
                isAvailable: true, 
                currentLocation: WAREHOUSE_LOCATION,
                assignedZone: 'Unzoned' 
            }
        });

        // Clear Routes
        await Route.deleteMany({ status: { $ne: 'completed' } });
        
        // Reset Deliveries
        await Delivery.updateMany(
            { status: { $in: ['assigned', 'in_transit'] } }, 
            { status: 'pending', assignedDriver: null }
        );
        
        const io = req.app.get('socketio');
        if(io) io.emit('scheduleUpdated', { message: 'System Reset: All drivers reset.' });
        
        res.status(200).json({ msg: 'System reset successful.' });
    } catch (err) {
        console.error('Reset Error:', err.message);
        res.status(500).send('Server Error');
    }
};