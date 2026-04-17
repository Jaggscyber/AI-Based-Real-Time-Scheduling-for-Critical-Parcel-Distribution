const mongoose = require('mongoose');
const axios = require('axios');
const Route = require('../models/routeModel');
const Driver = require('../models/driverModel');
const Delivery = require('../models/deliveryModel');
const { calculateOptimizedRoute } = require('../utils/routeOptimizer');
require('dotenv').config();

const ORS_KEY = process.env.ORS_API_KEY;

// ── ORS Directions Proxy ──────────────────────────────────────────────────────
// POST /api/routes/directions
// Body: { waypoints: [[lat,lng], ...], avoidPoints?: [[lat,lng], ...] }
exports.getOrsDirections = async (req, res) => {
    const { waypoints, avoidPoints = [] } = req.body;
    if (!waypoints || waypoints.length < 2) {
        return res.status(400).json({ msg: 'At least 2 waypoints required' });
    }
    try {
        // ORS expects [lng, lat]
        const coordinates = waypoints.map(([lat, lng]) => [lng, lat]);

        const body = { coordinates };

        // Inject avoid_polygons for traffic blocks
        if (avoidPoints.length > 0) {
            const polygons = avoidPoints.map(([blat, blng]) => {
                const r = 0.003; // ~300m
                const pts = [];
                for (let i = 0; i <= 8; i++) {
                    const angle = (i / 8) * 2 * Math.PI;
                    pts.push([blng + r * Math.cos(angle), blat + r * Math.sin(angle)]);
                }
                return [[pts]];
            });
            body.options = {
                avoid_polygons: { type: 'MultiPolygon', coordinates: polygons }
            };
        }

        const url = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';
        const response = await axios.post(url, body, {
            headers: {
                'Authorization': ORS_KEY,
                'Content-Type': 'application/json',
                'Accept': 'application/json, application/geo+json'
            },
            timeout: 12000
        });

        const feature = response.data.features[0];
        const summary = feature.properties.summary;
        const polyline = feature.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const distKm = +(summary.distance / 1000).toFixed(2);
        const durationMin = +(summary.duration / 60).toFixed(1);

        return res.json({
            polyline,
            totalDistance: distKm,
            totalDuration: durationMin,
            totalDistanceStr: distKm.toFixed(1) + ' km',
            totalDurationStr: Math.round(durationMin) + ' min',
            source: 'ors'
        });

    } catch (err) {
        const orsError = err.response?.data?.error?.message || err.message;
        console.warn('[ORS Directions] Failed:', orsError);

        // ── OSRM fallback (alternative server) ───────────────────────────────
        try {
            const coords = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
            const osrmUrl = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=full&geometries=geojson`;
            const osrmRes = await axios.get(osrmUrl, { timeout: 12000 });
            if (osrmRes.data.code === 'Ok' && osrmRes.data.routes?.length) {
                const route = osrmRes.data.routes[0];
                const poly = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
                const distKm = +(route.distance / 1000).toFixed(2);
                const durMin = +(route.duration / 60).toFixed(1);
                return res.json({
                    polyline: poly,
                    totalDistance: distKm,
                    totalDuration: durMin,
                    totalDistanceStr: distKm.toFixed(1) + ' km',
                    totalDurationStr: Math.round(durMin) + ' min',
                    source: 'osrm-alt'
                });
            }
        } catch (osrmErr) {
            console.warn('[OSRM Alt] Failed:', osrmErr.message);
        }

        // ── Original OSRM fallback ────────────────────────────────────────────
        try {
            const coords = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
            const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
            const osrmRes = await axios.get(osrmUrl, { timeout: 10000 });
            if (osrmRes.data.code === 'Ok' && osrmRes.data.routes?.length) {
                const route = osrmRes.data.routes[0];
                const poly = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
                const distKm = +(route.distance / 1000).toFixed(2);
                const durMin = +(route.duration / 60).toFixed(1);
                return res.json({
                    polyline: poly,
                    totalDistance: distKm,
                    totalDuration: durMin,
                    totalDistanceStr: distKm.toFixed(1) + ' km',
                    totalDurationStr: Math.round(durMin) + ' min',
                    source: 'osrm'
                });
            }
        } catch (osrmErr2) {
            console.warn('[OSRM Original] Failed:', osrmErr2.message);
        }

        // ── Haversine straight-line as last resort ────────────────────────────
        let totalKm = 0;
        for (let i = 0; i < waypoints.length - 1; i++) {
            const [lat1, lng1] = waypoints[i];
            const [lat2, lng2] = waypoints[i + 1];
            const R = 6371;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
            totalKm += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
        return res.json({
            polyline: waypoints,
            totalDistance: +totalKm.toFixed(2),
            totalDuration: +(totalKm * 3).toFixed(1),
            totalDistanceStr: totalKm.toFixed(1) + ' km',
            totalDurationStr: Math.round(totalKm * 3) + ' min',
            source: 'straight-line',
            error: orsError
        });
    }
};

// ── ORS Geocoding Proxy ───────────────────────────────────────────────────────
exports.getOrsGeocode = async (req, res) => {
    const { text } = req.query;
    if (!text) return res.status(400).json({ msg: 'text query param required' });
    try {
        // Try ORS geocoding
        const url = `https://api.openrouteservice.org/geocode/search?text=${encodeURIComponent(text)}&api_key=${ORS_KEY}&size=1`;
        const response = await axios.get(url, { timeout: 8000 });
        const features = response.data.features;
        if (!features || features.length === 0) {
            return res.status(404).json({ msg: 'No results found' });
        }
        const [lng, lat] = features[0].geometry.coordinates;
        return res.json({ lat, lng, label: features[0].properties.label });
    } catch (err) {
        // Fallback: Nominatim (OSM)
        try {
            const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(text)}&limit=1`;
            const nomRes = await axios.get(nomUrl, {
                timeout: 8000,
                headers: { 'User-Agent': 'ParcelDistributionAI/1.0' }
            });
            if (nomRes.data?.length > 0) {
                return res.json({
                    lat: parseFloat(nomRes.data[0].lat),
                    lng: parseFloat(nomRes.data[0].lon),
                    label: nomRes.data[0].display_name
                });
            }
        } catch (nomErr) {
            console.warn('[Nominatim] Failed:', nomErr.message);
        }
        return res.status(502).json({ msg: 'Geocoding failed from all providers' });
    }
};

const WAREHOUSE_COORDS = { type: 'Point', coordinates: [80.2707, 13.0827] };

const toWaypointStr = (coords) => {
    if (Array.isArray(coords)) return `${coords[1]},${coords[0]}`;
    if (coords?.lat && coords?.lng) return `${coords.lat},${coords.lng}`;
    return null;
};

exports.getRouteLeg = async (req, res) => {
    const { start, end } = req.body;
    try {
        const startStr = toWaypointStr(start);
        const endStr = toWaypointStr(end);
        if (!startStr || !endStr) return res.status(400).json({ msg: 'Invalid coordinates' });
        const result = await calculateOptimizedRoute([startStr, endStr]);
        if (result) res.status(200).json({ polyline: result.polyline });
        else res.status(500).json({ msg: 'Could not calculate path' });
    } catch (err) {
        console.error('Leg Error:', err.message);
        res.status(500).send('Server Error');
    }
};

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
            return res.status(200).json({ driver, stops: [], status: 'inactive' });
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
        console.error('Error fetching routes:', err.message);
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
        if (io) io.emit('scheduleUpdated', { message: `New delivery assigned to ${driver.name}` });
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
            ? toWaypointStr(currentLocation)
            : toWaypointStr(WAREHOUSE_COORDS.coordinates);

        const warehouseStr = toWaypointStr(WAREHOUSE_COORDS.coordinates);

        if (!route && currentLocation) {
            const result = await calculateOptimizedRoute([startPoint, warehouseStr]);
            return res.status(200).json({ polyline: result?.polyline || '' });
        }

        if (!route) return res.status(404).json({ msg: 'Active route not found.' });

        const remainingStops = route.stops.filter(s => s.status !== 'delivered');

        if (remainingStops.length === 0) {
            const result = await calculateOptimizedRoute([startPoint, warehouseStr]);
            if (result) { route.polyline = result.polyline; await route.save(); }
            return res.status(200).json(route);
        }

        const waypoints = [
            startPoint,
            ...remainingStops.map(stop => toWaypointStr(stop.pickupLocation.coordinates))
        ];

        const optimizationResult = await calculateOptimizedRoute(waypoints);
        if (!optimizationResult) return res.status(200).json(route);

        route.polyline = optimizationResult.polyline;
        route.totalDistance = optimizationResult.totalDistance;
        route.totalDuration = optimizationResult.totalDuration;
        route.legs = optimizationResult.legs;
        await route.save();

        const finalRoute = await Route.findById(route._id)
            .populate('driver', 'name currentLocation')
            .populate('stops');
        res.status(200).json(finalRoute);

    } catch (error) {
        console.error('Error recalculating route:', error.message);
        res.status(500).send('Server Error');
    }
};