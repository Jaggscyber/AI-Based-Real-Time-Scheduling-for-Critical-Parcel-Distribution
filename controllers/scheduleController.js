const axios = require('axios');
const Driver = require('../models/driverModel');
const Delivery = require('../models/deliveryModel');
const Route = require('../models/routeModel');

exports.generateSchedule = async (req, res) => {
  try {
    const { algorithm, blockages } = req.body;

    const [availableDrivers, pendingDeliveries] = await Promise.all([
      Driver.find({ isAvailable: true }),
      Delivery.find({ status: 'pending' })
    ]);

    if (pendingDeliveries.length === 0) return res.status(200).json({ message: 'No pending deliveries.' });
    if (availableDrivers.length === 0) return res.status(400).json({ message: 'No drivers available.' });

    // Zone-aware driver selection
    const deliveryZones = [...new Set(pendingDeliveries.map(d => d.zone || 'Unzoned'))];
    let capableDrivers = availableDrivers.filter(d => d.assignedZone && deliveryZones.includes(d.assignedZone));
    if (capableDrivers.length === 0) capableDrivers = availableDrivers;

    // ── Try Python AI service first ──────────────────────────────────────────
    try {
      const aiServiceUrl = 'http://127.0.0.1:5001/schedule';
      const payload = { deliveries: pendingDeliveries, drivers: capableDrivers, algorithm: algorithm || 'genetic', blockages: blockages || [] };
      const response = await axios.post(aiServiceUrl, payload, { timeout: 8000 });
      const optimizedRoutes = response.data;

      const databaseUpdatePromises = [];
      const summaryMessages = [];

      for (const routeKey in optimizedRoutes) {
        const routeData = optimizedRoutes[routeKey];
        if (!routeData || !routeData.stops || routeData.stops.length === 0) continue;
        const driverId = routeData.driver._id;
        const deliveryIds = routeData.stops.map(d => d._id);

        // Build ORS polyline for this driver's stops
        let orsPolyline = null;
        try {
          const WAREHOUSE = [13.0827, 80.2707];
          const waypoints = [WAREHOUSE, ...routeData.stops.map(s => [s.pickupLocation.coordinates[1], s.pickupLocation.coordinates[0]])];
          const orsRes = await axios.post('http://localhost:5000/api/routes/directions', { waypoints }, { timeout: 12000 });
          if (orsRes.data?.polyline?.length > 2) orsPolyline = JSON.stringify(orsRes.data.polyline);
        } catch (_) { /* ORS unavailable — will use AI polyline */ }

        const newRoute = new Route({
          driver: driverId,
          stops: deliveryIds,
          status: 'assigned',
          polyline: orsPolyline || routeData.polyline,
          totalDistance: routeData.total_distance,
          totalDuration: routeData.total_duration,
          legs: routeData.legs,
        });
        databaseUpdatePromises.push(newRoute.save());
        databaseUpdatePromises.push(Delivery.updateMany({ _id: { $in: deliveryIds } }, { $set: { status: 'assigned', assignedDriver: driverId } }));
        databaseUpdatePromises.push(Driver.findByIdAndUpdate(driverId, { isAvailable: false }));
        summaryMessages.push(`${routeData.driver.name} (${deliveryIds.length} stops)`);
      }

      await Promise.all(databaseUpdatePromises);

      const finalMessage = blockages?.length > 0
        ? `Schedule Updated! AI rerouted ${summaryMessages.length} drivers around ${blockages.length} traffic blocks.`
        : `Schedule Generated! Assigned ${summaryMessages.length} routes.`;
      const io = req.app.get('socketio');
      if (io) {
        io.emit('scheduleUpdated', { message: finalMessage, blockages: blockages?.length || 0 });
        if (blockages?.length > 0) io.emit('trafficBlockAlert', { type: 'traffic_block', blockCount: blockages.length, blockages, message: `🚧 Admin blocked ${blockages.length} road(s). Your route has been re-optimized.` });
      }
      return res.status(200).json({ success: true, message: finalMessage });

    } catch (aiError) {
      console.warn('Python AI service unavailable — using Node.js fallback scheduler:', aiError.message);
    }

    // ── Node.js Fallback: round-robin assign + ORS road polylines ────────────
    const WAREHOUSE = [13.0827, 80.2707];
    const driverGroups = {};
    capableDrivers.forEach(d => { driverGroups[d._id.toString()] = { driver: d, deliveries: [] }; });

    pendingDeliveries.forEach((del, i) => {
      const driver = capableDrivers[i % capableDrivers.length];
      driverGroups[driver._id.toString()].deliveries.push(del);
    });

    const dbPromises = [];
    const summaryMessages = [];

    for (const driverId of Object.keys(driverGroups)) {
      const { driver, deliveries } = driverGroups[driverId];
      if (deliveries.length === 0) continue;

      const deliveryIds = deliveries.map(d => d._id);

      // Build ORS road polyline: warehouse → each delivery stop
      let orsPolyline = null;
      let totalDistance = null;
      let totalDuration = null;
      try {
        const waypoints = [WAREHOUSE, ...deliveries.map(d => [d.pickupLocation.coordinates[1], d.pickupLocation.coordinates[0]])];
        const orsRes = await axios.post('http://localhost:5000/api/routes/directions', { waypoints }, { timeout: 15000 });
        if (orsRes.data?.polyline?.length > 2) {
          orsPolyline = JSON.stringify(orsRes.data.polyline);
          totalDistance = orsRes.data.totalDistanceStr || `${orsRes.data.totalDistance} km`;
          totalDuration = orsRes.data.totalDurationStr || `${orsRes.data.totalDuration} min`;
        }
      } catch (orsErr) {
        console.warn(`[ORS fallback] driver ${driver.name}:`, orsErr.message);
      }

      const newRoute = new Route({
        driver: driverId,
        stops: deliveryIds,
        status: 'assigned',
        polyline: orsPolyline || undefined,
        totalDistance: totalDistance || `~ km`,
        totalDuration: totalDuration || `~ min`,
      });

      dbPromises.push(newRoute.save());
      dbPromises.push(Delivery.updateMany({ _id: { $in: deliveryIds } }, { $set: { status: 'assigned', assignedDriver: driverId } }));
      dbPromises.push(Driver.findByIdAndUpdate(driverId, { isAvailable: false }));
      summaryMessages.push(`${driver.name} (${deliveries.length} stops)`);
    }

    await Promise.all(dbPromises);

    const finalMessage = `Schedule Generated (Node fallback)! Assigned ${summaryMessages.length} routes: ${summaryMessages.join(', ')}`;
    const io = req.app.get('socketio');
    if (io) {
      io.emit('scheduleUpdated', { message: finalMessage });
      if (blockages?.length > 0) io.emit('trafficBlockAlert', { type: 'traffic_block', blockCount: blockages.length, blockages, message: `🚧 Admin blocked ${blockages.length} road(s).` });
    }
    return res.status(200).json({ success: true, message: finalMessage });

  } catch (error) {
    console.error('Error in generateSchedule:', error.message);
    res.status(500).json({ message: 'Schedule generation failed: ' + error.message });
  }
};


// NEW: Handle automatic traffic block detection and route re-optimization
exports.handleTrafficBlock = async (req, res) => {
  try {
    const { blockages, affectedRoutes } = req.body;

    // Find all active routes that might be affected
    const Route = require('../models/routeModel');
    const activeRoutes = await Route.find({ status: 'assigned' }).populate('driver').populate('stops');

    const reoptimizationPromises = [];
    const affectedDrivers = [];

    for (const route of activeRoutes) {
      // Check if route is affected by traffic blocks
      const isAffected = checkRouteAffectedByBlocks(route, blockages);
      if (isAffected) {
        affectedDrivers.push(route.driver._id);
        // Re-optimize this route
        reoptimizationPromises.push(reoptimizeRoute(route._id, blockages));
      }
    }

    await Promise.all(reoptimizationPromises);

    const io = req.app.get('socketio');
    if (io && affectedDrivers.length > 0) {
      io.emit('trafficBlockUpdate', {
        message: `🚧 Traffic block detected! Re-optimized routes for ${affectedDrivers.length} drivers.`,
        blockages: blockages,
        affectedDrivers: affectedDrivers,
        type: 'traffic_block'
      });
    }

    res.status(200).json({
      success: true,
      message: `Routes re-optimized for ${affectedDrivers.length} drivers due to traffic blocks`,
      affectedDrivers: affectedDrivers.length
    });

  } catch (error) {
    console.error('Error in handleTrafficBlock:', error.message);
    res.status(500).json({ message: 'Failed to handle traffic block' });
  }
};

// NEW: Handle vehicle breakdown and reassign deliveries
exports.handleVehicleBreakdown = async (req, res) => {
  try {
    const { driverId, breakdownLocation } = req.body;

    const Route = require('../models/routeModel');
    const Delivery = require('../models/deliveryModel');
    const Driver = require('../models/driverModel');

    // Find the broken-down driver's current route + undelivered stops
    const currentRoute = await Route.findOne({ driver: driverId, status: 'assigned' })
      .populate('driver')
      .populate('stops');

    if (!currentRoute) {
      return res.status(404).json({ message: 'No active route found for driver' });
    }

    const undeliveredStops = currentRoute.stops.filter(s => s.status !== 'delivered');

    // Find nearest available driver (not the broken-down one)
    const nearbyDrivers = await findNearbyDrivers(breakdownLocation, driverId);

    // Also consider ALL drivers with active routes if no available drivers
    let assignedDriver = nearbyDrivers[0] || null;
    if (!assignedDriver) {
      // Fallback: find ANY other driver with an active route
      const anyDriver = await Driver.findOne({ _id: { $ne: driverId } }).sort({ createdAt: 1 });
      assignedDriver = anyDriver;
    }

    if (!assignedDriver) {
      return res.status(400).json({ message: 'No other drivers available to receive deliveries' });
    }

    // ── MERGE into the assigned driver's existing route (or create new) ──
    let targetRoute = await Route.findOne({ driver: assignedDriver._id, status: 'assigned' });

    const deliveryIds = undeliveredStops.map(d => d._id);

    if (targetRoute) {
      // Merge: push all undelivered stops into existing route
      const existingIds = targetRoute.stops.map(id => id.toString());
      for (const did of deliveryIds) {
        if (!existingIds.includes(did.toString())) {
          targetRoute.stops.push(did);
        }
      }
      await targetRoute.save();
    } else {
      // Create new route for the assisting driver
      targetRoute = new Route({
        driver: assignedDriver._id,
        stops: deliveryIds,
        status: 'assigned',
        breakdownPickup: true,
        originalDriver: driverId
      });
      await targetRoute.save();
    }

    // Update all reassigned deliveries' driver reference
    await Delivery.updateMany(
      { _id: { $in: deliveryIds } },
      { $set: { status: 'assigned', assignedDriver: assignedDriver._id } }
    );

    // Mark original driver as broken down
    await Driver.findByIdAndUpdate(driverId, {
      isAvailable: false,
      vehicleStatus: 'broken_down',
      breakdownLocation: breakdownLocation
    });

    // Update original route status
    await Route.findByIdAndUpdate(currentRoute._id, {
      status: 'broken_down',
      breakdownLocation: breakdownLocation
    });

    const io = req.app.get('socketio');
    if (io) {
      // Admin-wide alert
      io.emit('vehicleBreakdown', {
        message: `\ud83d\udea8 Breakdown! ${undeliveredStops.length} deliveries merged into ${assignedDriver.name}'s route.`,
        breakdownDriver: driverId,
        assignedDriver: assignedDriver._id.toString(),
        location: breakdownLocation,
        reassignedDeliveries: undeliveredStops.length,
        type: 'vehicle_breakdown'
      });
      // Notify the specific driver who is receiving the extra deliveries
      io.emit('routeAssigned', {
        driverId: assignedDriver._id.toString(),
        routeId: targetRoute._id.toString(),
        message: `\ud83d\udea8 ${undeliveredStops.length} deliveries transferred from a broken-down driver!`
      });
      // Also refresh admin
      io.emit('scheduleUpdated', {
        message: `Breakdown: ${undeliveredStops.length} deliveries reassigned to ${assignedDriver.name}`
      });
    }

    res.status(200).json({
      success: true,
      message: `${undeliveredStops.length} deliveries merged into ${assignedDriver.name}'s route`,
      assignedDriver: assignedDriver._id,
      reassignedDeliveries: undeliveredStops.length
    });

  } catch (error) {
    console.error('Error in handleVehicleBreakdown:', error.message);
    res.status(500).json({ message: 'Failed to handle vehicle breakdown' });
  }
};

// Helper function to check if route is affected by traffic blocks
function checkRouteAffectedByBlocks(route, blockages) {
  if (!route.polyline || !blockages || blockages.length === 0) return false;

  try {
    const routeCoords = JSON.parse(route.polyline);
    for (const block of blockages) {
      for (const coord of routeCoords) {
        const distance = calculateDistance(coord[0], coord[1], block[0], block[1]);
        if (distance < 0.5) { // Within 500 meters
          return true;
        }
      }
    }
  } catch (e) {
    console.error('Error checking route blocks:', e);
  }
  return false;
}

// Helper function to re-optimize a single route
async function reoptimizeRoute(routeId, blockages) {
  const Route = require('../models/routeModel');
  const route = await Route.findById(routeId).populate('stops');

  if (!route) return;

  // Call AI service to re-optimize this specific route
  const aiServiceUrl = 'http://127.0.0.1:5001/reoptimize-route';

  const payload = {
    route: route,
    blockages: blockages || []
  };

  try {
    const response = await axios.post(aiServiceUrl, payload);
    const optimizedRoute = response.data;

    // Update route with new polyline
    await Route.findByIdAndUpdate(routeId, {
      polyline: optimizedRoute.polyline,
      totalDistance: optimizedRoute.total_distance,
      totalDuration: optimizedRoute.total_duration,
      legs: optimizedRoute.legs,
      lastOptimized: new Date()
    });
  } catch (error) {
    console.error('Failed to re-optimize route:', error);
  }
}

// Helper function to find nearby drivers (includes on-route drivers for breakdown scenarios)
async function findNearbyDrivers(location, excludeDriverId) {
  const Driver = require('../models/driverModel');

  // Include ALL drivers except the broken one — on-route drivers can also receive extra stops
  const allDrivers = await Driver.find({
    _id: { $ne: excludeDriverId },
    vehicleStatus: { $ne: 'broken_down' }
  });

  const driversWithDistance = allDrivers.map(driver => {
    if (driver.currentLocation && driver.currentLocation.coordinates) {
      const distance = calculateDistance(
        location[0], location[1],
        driver.currentLocation.coordinates[1], driver.currentLocation.coordinates[0]
      );
      return { ...driver.toObject(), distance };
    }
    return { ...driver.toObject(), distance: 999 };
  });

  return driversWithDistance
    .filter(d => d.distance < 20) // Within 20km
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5); // Top 5 nearest
}

// Helper function to check driver capacity
async function checkDriverCapacity(driverId) {
  const Route = require('../models/routeModel');
  const activeRoute = await Route.findOne({ driver: driverId, status: 'assigned' });

  if (!activeRoute) return 10; // Max capacity if no active route

  return Math.max(0, 10 - activeRoute.stops.length); // Assuming max 10 deliveries per driver
}

// Helper function to calculate distance between coordinates
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Core allocation logic — shared by both the REST endpoint and deliveryController
async function autoAllocateDelivery(deliveryId, io) {
  const Delivery = require('../models/deliveryModel');
  const Driver = require('../models/driverModel');
  const Route = require('../models/routeModel');

  const delivery = await Delivery.findById(deliveryId);
  if (!delivery) throw new Error('Delivery not found');

  const availableDrivers = await Driver.find({ isAvailable: true });
  if (availableDrivers.length === 0) throw new Error('No available drivers');

  // Pick nearest driver to the delivery location
  let bestDriver = null;
  let minDistance = Infinity;

  for (const driver of availableDrivers) {
    let dLat = 13.0827, dLng = 80.2707; // default: warehouse
    if (driver.currentLocation && driver.currentLocation.coordinates) {
      dLng = driver.currentLocation.coordinates[0];
      dLat = driver.currentLocation.coordinates[1];
    }
    const dist = calculateDistance(
      dLat, dLng,
      delivery.pickupLocation.coordinates[1],
      delivery.pickupLocation.coordinates[0]
    );
    if (dist < minDistance) { minDistance = dist; bestDriver = driver; }
  }

  if (!bestDriver) throw new Error('No suitable driver found');

  // --- Try AI service for a proper route --------------------------------
  let polyline = JSON.stringify([[13.0827, 80.2707], [delivery.pickupLocation.coordinates[1], delivery.pickupLocation.coordinates[0]]]);
  let totalDistance = `${minDistance.toFixed(1)} km`;
  let totalDuration = `${Math.ceil(minDistance * 3)} min`;
  let legs = [];

  try {
    const existingRoute = await Route.findOne({ driver: bestDriver._id, status: 'assigned' }).populate('stops');
    const allStops = existingRoute ? [...existingRoute.stops, delivery] : [delivery];

    const aiResponse = await axios.post('http://127.0.0.1:5001/schedule', {
      deliveries: allStops,
      drivers: [bestDriver],
      algorithm: 'gmaps-tsp',
      blockages: []
    }, { timeout: 10000 });

    const routeData = Object.values(aiResponse.data)[0];
    if (routeData && routeData.polyline) {
      polyline = routeData.polyline;
      totalDistance = routeData.total_distance || totalDistance;
      totalDuration = routeData.total_duration || totalDuration;
      legs = routeData.legs || [];
    }
  } catch (aiErr) {
    console.warn('AI service unavailable during auto-allocate, using straight-line estimate:', aiErr.message);
  }
  // -----------------------------------------------------------------------

  // Upsert route
  let driverRoute = await Route.findOne({ driver: bestDriver._id, status: 'assigned' });
  if (driverRoute) {
    driverRoute.stops.push(deliveryId);
    driverRoute.polyline = polyline;
    driverRoute.totalDistance = totalDistance;
    driverRoute.totalDuration = totalDuration;
    driverRoute.legs = legs;
    await driverRoute.save();
  } else {
    driverRoute = new Route({
      driver: bestDriver._id,
      stops: [deliveryId],
      status: 'assigned',
      polyline,
      totalDistance,
      totalDuration,
      legs
    });
    await driverRoute.save();
  }

  // Update delivery + driver
  await Delivery.findByIdAndUpdate(deliveryId, { status: 'assigned', assignedDriver: bestDriver._id });
  await Driver.findByIdAndUpdate(bestDriver._id, { isAvailable: false });

  // Emit events
  if (io) {
    // Admin-wide refresh
    io.emit('scheduleUpdated', {
      message: `📦 Delivery automatically assigned to ${bestDriver.name}`
    });
    // Driver-specific notification — DriverDashboard listens for this
    io.emit('routeAssigned', {
      driverId: bestDriver._id.toString(),
      routeId: driverRoute._id.toString(),
      message: `New delivery added to your route!`
    });
  }

  return { driver: bestDriver, route: driverRoute };
}

// Expose helper so deliveryController can call it without going through HTTP
exports.autoAllocateDelivery = autoAllocateDelivery;

// REST endpoint wrapper
exports.allocateDeliveryAutomatically = async (req, res) => {
  try {
    const { deliveryId } = req.body;
    const io = req.app.get('socketio');
    const result = await autoAllocateDelivery(deliveryId, io);
    res.status(200).json({
      success: true,
      message: `Delivery assigned to ${result.driver.name}`,
      driverName: result.driver.name,
      driverId: result.driver._id
    });
  } catch (error) {
    console.error('Error in allocateDeliveryAutomatically:', error.message);
    const statusCode = error.message.includes('No available') ? 400 : 500;
    res.status(statusCode).json({ message: error.message || 'Failed to allocate delivery automatically' });
  }
};