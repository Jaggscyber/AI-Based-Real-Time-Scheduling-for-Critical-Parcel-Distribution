const mongoose = require('mongoose');
const Route = require('../models/routeModel');
const Driver = require('../models/driverModel');
const Delivery = require('../models/deliveryModel');
const { calculateOptimizedRoute } = require('../utils/routeOptimizer');

const WAREHOUSE_COORDS = { type: 'Point', coordinates: [80.2707, 13.0827] };

// Helper to swap [Lng, Lat] -> "Lat,Lng"
const toGoogleCoords = (coords) => {
    if (Array.isArray(coords)) return `${coords[1]},${coords[0]}`; 
    if (coords && coords.lat && coords.lng) return `${coords.lat},${coords.lng}`;
    return null;
};

// --- NEW FUNCTION: GET SINGLE LEG ROUTE ---
exports.getRouteLeg = async (req, res) => {
    const { start, end } = req.body; // Expects objects {lat, lng} or arrays [lng, lat]
    
    try {
        const startStr = toGoogleCoords(start);
        const endStr = toGoogleCoords(end);
        
        if(!startStr || !endStr) {
            return res.status(400).json({ msg: "Invalid coordinates" });
        }

        // Calculate route for just these 2 points
        const result = await calculateOptimizedRoute([startStr, endStr]);
        
        if (result) {
            res.status(200).json({ polyline: result.polyline });
        } else {
            res.status(500).json({ msg: "Could not calculate path" });
        }
    } catch (err) {
        console.error("Leg Error:", err.message);
        res.status(500).send('Server Error');
    }
};
// ------------------------------------------

exports.getDriverRoute = async (req, res) => {
  try {
    let route = await Route.findOne({
      driver: req.params.driverId,
      status: { $ne: 'completed' }
    })
    .populate('driver', 'name currentLocation')
    .populate({ path: 'stops', model: 'Delivery' });

    if (!route) {
        const driver = await Driver.findById(req.params.driverId).select('name currentLocation');
        if (!driver) return res.status(404).json({ msg: 'Driver not found.' });
        return res.status(200).json({ driver: driver, stops: [], status: 'inactive' });
    }
    res.status(200).json(route);
  } catch (error) {
    console.error('Error fetching driver route:', error.message);
    res.status(500).send('Server Error');
  }
};

exports.getAllRoutes = async (req, res) => {
    try {
        const routes = await Route.find({ status: { $ne: 'completed' } })
            .populate('driver', 'name')
            .populate('stops');
        res.status(200).json(routes);
    } catch (err) {
        console.error("Error fetching routes:", err.message);
        res.status(500).send('Server Error');
    }
};

exports.addStopToRoute = async (req, res) => {
    const { driverId, deliveryId } = req.body;
    try {
        const driver = await Driver.findById(driverId);
        if (!driver) return res.status(404).json({ msg: 'Driver not found.' });

        const delivery = await Delivery.findById(deliveryId);
        if (!delivery || delivery.status !== 'pending') {
            return res.status(400).json({ msg: 'Delivery not pending.' });
        }

        let route = await Route.findOne({ driver: driverId, status: { $ne: 'completed' } });
        if (route) {
            route.stops.push(deliveryId);
        } else {
            route = new Route({ driver: driverId, stops: [deliveryId], status: 'assigned' });
        }
        await route.save();

        driver.isAvailable = false;
        await driver.save();
        
        delivery.status = 'assigned';
        delivery.assignedDriver = driverId;
        await delivery.save();
        
        const io = req.app.get('socketio');
        if(io) io.emit('scheduleUpdated', { message: `New delivery assigned to ${driver.name}` });
        res.status(200).json(route);
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.recalculateRoute = async (req, res) => {
    const { driverId, currentLocation } = req.body;
    try {
        const route = await Route.findOne({ driver: driverId, status: { $ne: 'completed' } }).populate('stops');
        
        const startPoint = currentLocation 
            ? toGoogleCoords(currentLocation) 
            : toGoogleCoords(WAREHOUSE_COORDS.coordinates); 

        const warehouseStr = toGoogleCoords(WAREHOUSE_COORDS.coordinates);

        if (!route && currentLocation) {
            const waypoints = [startPoint, warehouseStr];
            const result = await calculateOptimizedRoute(waypoints);
            return res.status(200).json({ polyline: result?.polyline || '' });
        }

        if (!route) return res.status(404).json({ msg: 'Active route not found.' });

        const remainingStops = route.stops.filter(stop => stop.status !== 'delivered');
        
        if (remainingStops.length === 0) {
            const waypoints = [startPoint, warehouseStr];
            const result = await calculateOptimizedRoute(waypoints);
            if (result) {
                route.polyline = result.polyline;
                await route.save();
            }
            return res.status(200).json(route);
        }
        
        const waypoints = [
            startPoint, 
            ...remainingStops.map(stop => toGoogleCoords(stop.pickupLocation.coordinates))
        ];

        const optimizationResult = await calculateOptimizedRoute(waypoints);

        if (!optimizationResult) {
            return res.status(200).json(route); 
        }
        
        route.polyline = optimizationResult.polyline;
        route.totalDistance = optimizationResult.totalDistance;
        route.totalDuration = optimizationResult.totalDuration;
        route.legs = optimizationResult.legs;
        await route.save();
        
        const finalRoute = await Route.findById(route._id).populate('driver', 'name currentLocation').populate('stops');
        res.status(200).json(finalRoute);

    } catch (error) {
        console.error('Error recalculating route:', error.message);
        res.status(500).send('Server Error');
    }
};