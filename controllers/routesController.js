const mongoose = require('mongoose');
const Route = require('../models/routeModel');
const Driver = require('../models/driverModel');
const Delivery = require('../models/deliveryModel');
const { calculateOptimizedRoute } = require('../utils/routeOptimizer');

const WAREHOUSE_COORDS = { type: 'Point', coordinates: [80.2707, 13.0827] };

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
        if (!driver) {
            return res.status(404).json({ msg: 'Driver not found.' });
        }
        // If no route, return a default inactive structure
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
      .populate('driver', 'name currentLocation')
      .populate('stops');
    res.status(200).json(routes);
  } catch (error) {
    console.error('Error fetching all routes:', error.message);
    res.status(500).send('Server Error');
  }
};

exports.addStopToRoute = async (req, res) => {
    const { driverId, deliveryId } = req.body;
    try {
        const driver = await Driver.findById(driverId);
        if (!driver) { return res.status(404).json({ msg: 'Driver not found.' }); }

        const delivery = await Delivery.findById(deliveryId);
        if (!delivery || delivery.status !== 'pending') {
            return res.status(400).json({ msg: 'This delivery is not pending.' });
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
        io.emit('scheduleUpdated', { message: `New delivery assigned to driver ${driver.name}` });
        res.status(200).json(route);
    } catch (err) {
        res.status(500).send('Server Error');
    }
};

exports.recalculateRoute = async (req, res) => {
    const { driverId, currentLocation } = req.body;
    try {
        const route = await Route.findOne({ driver: driverId, status: { $ne: 'completed' } }).populate('stops');
        
        // This case handles a driver finishing their last delivery and needing a route to the warehouse
        if (!route && currentLocation) {
            const waypoints = [`${currentLocation.lng},${currentLocation.lat}`, WAREHOUSE_COORDS.coordinates.join(',')];
            const optimizationResult = await calculateOptimizedRoute(waypoints);
            return res.status(200).json({ polyline: optimizationResult.polyline });
        }

        if (!route) {
            return res.status(404).json({ msg: 'Active route not found for this driver.' });
        }

        const remainingStops = route.stops.filter(stop => stop.status !== 'delivered');
        
        // This case handles the final delivery and generates the route to the warehouse
        if (remainingStops.length === 0) {
            const startPoint = currentLocation ? `${currentLocation.lng},${currentLocation.lat}` : WAREHOUSE_COORDS.coordinates.join(',');
            const waypoints = [startPoint, WAREHOUSE_COORDS.coordinates.join(',')];
            const optimizationResult = await calculateOptimizedRoute(waypoints);
            if (optimizationResult) {
                route.polyline = optimizationResult.polyline;
                await route.save();
            }
            return res.status(200).json(route);
        }
        
        // This case handles normal mid-route recalculations
        const startPoint = currentLocation ? `${currentLocation.lng},${currentLocation.lat}` : WAREHOUSE_COORDS.coordinates.join(',');
        const waypoints = [startPoint, ...remainingStops.map(stop => stop.pickupLocation.coordinates.join(','))];
        const optimizationResult = await calculateOptimizedRoute(waypoints);

        if (!optimizationResult) {
            return res.status(500).json({ msg: 'Failed to recalculate route.' });
        }
        
        route.polyline = optimizationResult.polyline;
        route.totalDistance = optimizationResult.totalDistance;
        route.totalDuration = optimizationResult.totalDuration;
        route.legs = optimizationResult.legs;
        await route.save();
        
        const finalRoute = await Route.findById(route._id).populate('driver', 'name currentLocation').populate({ path: 'stops', model: 'Delivery' });
        res.status(200).json(finalRoute);

    } catch (error) {
        console.error('Error recalculating route:', error.message);
        res.status(500).send('Server Error');
    }
};
// The extra brace that was here has been removed