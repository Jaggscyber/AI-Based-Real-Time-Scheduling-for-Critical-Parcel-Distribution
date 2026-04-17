const express = require('express');
const router = express.Router();
const fuelManager = require('../utils/fuelManager');
const trafficManager = require('../utils/trafficManager');
const breakdownManager = require('../utils/driverBreakdownManager');

// ===== FUEL MANAGEMENT ROUTES =====

/**
 * Calculate fuel consumption for a trip
 * POST /api/fuel/calculate
 * Body: { vehicleType, fuelType, distanceKm }
 */
router.post('/calculate', (req, res) => {
    try {
        const { vehicleType, fuelType, distanceKm } = req.body;

        if (!vehicleType || !fuelType || !distanceKm) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const result = fuelManager.calculateFuelConsumption(vehicleType, fuelType, distanceKm);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Find nearby fuel/charging stations
 * GET /api/fuel/nearby?lat=13.0827&lng=80.2707&vehicleType=EV&radiusKm=10
 */
router.get('/nearby', (req, res) => {
    try {
        const { lat, lng, vehicleType, radiusKm = 10 } = req.query;

        if (!lat || !lng || !vehicleType) {
            return res.status(400).json({ error: 'Missing required parameters: lat, lng, vehicleType' });
        }

        const stations = fuelManager.findNearbyStations(
            parseFloat(lat),
            parseFloat(lng),
            vehicleType,
            parseFloat(radiusKm)
        );

        res.json({
            location: { lat: parseFloat(lat), lng: parseFloat(lng) },
            vehicleType,
            radiusKm: parseFloat(radiusKm),
            stations,
            count: stations.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Check if vehicle can reach destination
 * POST /api/fuel/can-reach
 * Body: { vehicleType, fuelType, remainingFuelPercent, distanceToDestination }
 */
router.post('/can-reach', (req, res) => {
    try {
        const { vehicleType, fuelType, remainingFuelPercent, distanceToDestination } = req.body;

        if (!vehicleType || remainingFuelPercent === undefined || !distanceToDestination) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const result = fuelManager.canReachDestination(
            vehicleType,
            fuelType,
            remainingFuelPercent,
            distanceToDestination
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get all fuel stations
 * GET /api/fuel/stations
 */
router.get('/stations', (req, res) => {
    try {
        const stations = fuelManager.getAllFuelStations();
        res.json({ stations, count: stations.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get all charging stations
 * GET /api/fuel/charging-stations
 */
router.get('/charging-stations', (req, res) => {
    try {
        const stations = fuelManager.getAllChargingStations();
        res.json({ stations, count: stations.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== TRAFFIC MANAGEMENT ROUTES =====

/**
 * Add traffic block
 * POST /api/traffic/blocks
 * Body: { lat, lng, radius, severity, affectedStreet, eta }
 */
router.post('/blocks', (req, res) => {
    try {
        const { lat, lng, radius, severity, affectedStreet, eta } = req.body;

        if (!lat || !lng || !radius) {
            return res.status(400).json({ error: 'Missing required parameters: lat, lng, radius' });
        }

        const blockId = trafficManager.addTrafficBlock({
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            radius: parseFloat(radius),
            severity: severity || 2,
            affectedStreet: affectedStreet || 'Unknown',
            eta: eta || new Date()
        });

        // Notify all connected clients via Socket.io
        const io = require('express')().get('socketio');
        if (io) {
            io.emit('traffic-block-added', {
                blockId,
                data: trafficManager.getActiveBlocks().find(b => b.id === blockId)
            });
        }

        res.status(201).json({
            success: true,
            blockId,
            message: 'Traffic block reported'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get active traffic blocks
 * GET /api/traffic/blocks/active
 */
router.get('/blocks/active', (req, res) => {
    try {
        const activeBlocks = trafficManager.getActiveBlocks();
        res.json({
            count: activeBlocks.length,
            blocks: activeBlocks
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Check route impact
 * POST /api/traffic/check-route
 * Body: { route: [[lat1, lng1], [lat2, lng2], ...] }
 */
router.post('/check-route', (req, res) => {
    try {
        const { route } = req.body;

        if (!route || !Array.isArray(route)) {
            return res.status(400).json({ error: 'Invalid route format' });
        }

        const impact = trafficManager.checkRouteImpact(route);
        res.json(impact);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Create route version (after traffic update)
 * POST /api/traffic/route-version
 * Body: { driverId, newRoute, reason, originalRoute, timeDelayMinutes, trafficBlocksAvoided }
 */
router.post('/route-version', (req, res) => {
    try {
        const { driverId, newRoute, reason, originalRoute, timeDelayMinutes, trafficBlocksAvoided } = req.body;

        if (!driverId || !newRoute) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const version = trafficManager.createRouteVersion(driverId, newRoute, {
            reason,
            originalRoute,
            timeDelayMinutes,
            trafficBlocksAvoided
        });

        // Notify driver via Socket.io
        const io = require('express')().get('socketio');
        if (io) {
            io.to(`driver_${driverId}`).emit('route-updated', {
                newRoute,
                reason,
                version: version.versionNumber
            });
        }

        res.status(201).json({
            success: true,
            version
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get route history
 * GET /api/traffic/route-history/:driverId
 */
router.get('/route-history/:driverId', (req, res) => {
    try {
        const { driverId } = req.params;
        const history = trafficManager.getRouteHistory(driverId);
        res.json({
            driverId,
            versions: history,
            count: history.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Compare two route versions
 * GET /api/traffic/compare/:driverId/:v1/:v2
 */
router.get('/compare/:driverId/:v1/:v2', (req, res) => {
    try {
        const { driverId, v1, v2 } = req.params;
        const comparison = trafficManager.compareRoutes(driverId, parseInt(v1), parseInt(v2));
        res.json(comparison);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Resolve traffic block
 * PUT /api/traffic/blocks/:blockId/resolve
 */
router.put('/blocks/:blockId/resolve', (req, res) => {
    try {
        const { blockId } = req.params;
        trafficManager.resolveBlock(blockId);

        // Notify clients
        const io = require('express')().get('socketio');
        if (io) {
            io.emit('traffic-block-resolved', { blockId });
        }

        res.json({ success: true, message: 'Traffic block resolved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get traffic statistics
 * GET /api/traffic/statistics
 */
router.get('/statistics', (req, res) => {
    try {
        const stats = trafficManager.getTrafficStatistics();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== DRIVER BREAKDOWN ROUTES =====

/**
 * Report driver breakdown
 * POST /api/breakdown/report
 * Body: { driverId, location: [lat, lng], breakdownType, severity }
 */
router.post('/report', (req, res) => {
    try {
        const { driverId, location, breakdownType, severity } = req.body;

        if (!driverId || !location || !breakdownType) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const breakdownId = breakdownManager.reportBreakdown(
            driverId,
            location,
            breakdownType,
            severity || 'medium'
        );

        // Notify admin via Socket.io
        const io = require('express')().get('socketio');
        if (io) {
            io.emit('driver-breakdown-reported', {
                breakdownId,
                driverId,
                location,
                severity
            });
        }

        res.status(201).json({
            success: true,
            breakdownId,
            message: 'Breakdown reported successfully'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Find nearby drivers for assistance
 * POST /api/breakdown/:breakdownId/find-assistance
 * Body: { allAvailableDrivers, radiusKm, considerCapacity }
 */
router.post('/:breakdownId/find-assistance', (req, res) => {
    try {
        const { breakdownId } = req.params;
        const { allAvailableDrivers = [], radiusKm = 15, considerCapacity = true } = req.body;

        const nearbyDrivers = breakdownManager.findNearbyDriversForAssistance(
            breakdownId,
            allAvailableDrivers,
            radiusKm,
            considerCapacity
        );

        if (nearbyDrivers.error) {
            return res.status(404).json(nearbyDrivers);
        }

        res.json({
            breakdownId,
            nearbyDrivers,
            count: nearbyDrivers.length,
            topCandidate: nearbyDrivers[0] || null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Reassign deliveries
 * POST /api/breakdown/:breakdownId/reassign
 * Body: { targetDriverId, deliveriesToReassign: [id1, id2, ...] }
 */
router.post('/:breakdownId/reassign', (req, res) => {
    try {
        const { breakdownId } = req.params;
        const { targetDriverId, deliveriesToReassign = [] } = req.body;

        if (!targetDriverId) {
            return res.status(400).json({ error: 'Missing targetDriverId' });
        }

        const result = breakdownManager.reassignDeliveries(breakdownId, targetDriverId, deliveriesToReassign);

        if (result.error) {
            return res.status(404).json(result);
        }

        // Notify drivers via Socket.io
        const io = require('express')().get('socketio');
        if (io) {
            io.emit('deliveries-reassigned', {
                fromDriver: result.details.fromDriver,
                toDriver: targetDriverId,
                deliveries: deliveriesToReassign
            });
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get active breakdowns
 * GET /api/breakdown/active
 */
router.get('/active', (req, res) => {
    try {
        const breakdowns = breakdownManager.getActiveBreakdowns();
        res.json({
            count: breakdowns.length,
            breakdowns
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Resolve breakdown
 * PUT /api/breakdown/:breakdownId/resolve
 * Body: { resolution }
 */
router.put('/:breakdownId/resolve', (req, res) => {
    try {
        const { breakdownId } = req.params;
        const { resolution } = req.body;

        breakdownManager.resolveBreakdown(breakdownId, resolution);

        // Notify via Socket.io
        const io = require('express')().get('socketio');
        if (io) {
            io.emit('breakdown-resolved', { breakdownId });
        }

        res.json({ success: true, message: 'Breakdown resolved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get breakdown statistics
 * GET /api/breakdown/statistics
 */
router.get('/statistics', (req, res) => {
    try {
        const stats = breakdownManager.getBreakdownStatistics();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
