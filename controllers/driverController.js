const Driver = require('../models/driverModel');
const Delivery = require('../models/deliveryModel');
const Route = require('../models/routeModel');

const WAREHOUSE_LOCATION = { type: 'Point', coordinates: [80.2707, 13.0827] };

exports.getAllDrivers = async (req, res) => {
    try {
        let drivers = await Driver.find({ name: { $exists: true, $ne: "" } }).lean();
        drivers.forEach(driver => {
            if (!driver.currentLocation || !driver.currentLocation.coordinates) {
                driver.currentLocation = WAREHOUSE_LOCATION;
            }
        });
        res.status(200).json(drivers);
    } catch (err) {
        console.error('Error in getAllDrivers:', err.message);
        res.status(500).send('Server Error');
    }
};

exports.getDriverDetails = async (req, res) => {
    try {
        const { driverId } = req.params;
        const driver = await Driver.findById(driverId);
        if (!driver) { 
            return res.status(404).json({ msg: 'Driver not found' }); 
        }
        
        // THIS IS THE FIX: The query now finds any route that is not yet 'completed'.
        const activeRoute = await Route.findOne({ 
            driver: driverId, 
            status: { $ne: 'completed' } 
        }).populate('stops');
        
        const deliveryStatusCounts = { assigned: 0, in_transit: 0, delivered: 0 };
        if (activeRoute) {
            activeRoute.stops.forEach(stop => {
                if (deliveryStatusCounts.hasOwnProperty(stop.status)) {
                    deliveryStatusCounts[stop.status]++;
                }
            });
        }

        res.status(200).json({ 
            driver, 
            activeRoute,
            deliveryStatusCounts
        });
    } catch (err) {
        console.error('Error in getDriverDetails:', err.message);
        res.status(500).send('Server Error');
    }
};

exports.returnToWarehouse = async (req, res) => {
    try {
        const { driverId } = req.params;
        const driver = await Driver.findByIdAndUpdate(driverId, { isAvailable: true, currentLocation: WAREHOUSE_LOCATION }, { new: true });
        const io = req.app.get('socketio');
        io.emit('driverLocationUpdated', driver);
        res.status(200).json(driver);
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.resetAllDrivers = async (req, res) => {
    try {
        await Driver.updateMany({}, { isAvailable: true, currentLocation: WAREHOUSE_LOCATION });
        await Route.updateMany({ status: { $ne: 'completed' } }, { status: 'completed' });
        await Delivery.updateMany({ status: { $in: ['assigned', 'in_transit'] } }, { status: 'pending', assignedDriver: null });
        
        const io = req.app.get('socketio');
        io.emit('scheduleUpdated', { message: 'All drivers and routes have been reset.' });
        res.status(200).json({ msg: 'All drivers have been reset to available.' });
    } catch (err) {
        res.status(500).send('Server Error');
    }
};