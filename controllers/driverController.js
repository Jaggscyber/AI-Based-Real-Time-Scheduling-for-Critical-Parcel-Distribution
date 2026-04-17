const Driver = require('../models/driverModel');
const Delivery = require('../models/deliveryModel');
const Route = require('../models/routeModel');
const User = require('../models/userModel');
const bcrypt = require('bcryptjs');
const axios = require('axios');
require('dotenv').config();

const ORS_KEY = process.env.ORS_API_KEY;

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
        let drivers = await Driver.find({}).lean();
        drivers = drivers.map(d => {
            if (!d.currentLocation || !d.currentLocation.coordinates || d.currentLocation.coordinates.length !== 2) {
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

// --- 2b. GET ALL DRIVER LOCATIONS (lightweight, for 30s admin polling) ---
exports.getDriverLocations = async (req, res) => {
    try {
        const drivers = await Driver.find({}).select('name currentLocation fuelLevel isAvailable').lean();
        const locations = drivers.map(d => ({
            _id: d._id,
            name: d.name,
            fuelLevel: d.fuelLevel,
            isAvailable: d.isAvailable,
            lat: d.currentLocation?.coordinates?.[1] ?? WAREHOUSE_LOCATION.coordinates[1],
            lng: d.currentLocation?.coordinates?.[0] ?? WAREHOUSE_LOCATION.coordinates[0]
        }));
        res.status(200).json(locations);
    } catch (err) {
        console.error('Error fetching driver locations:', err.message);
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
        if (io) io.emit('scheduleUpdated', { message: `Zone assigned to ${driver.name}` });

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
        if (io) {
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
        if (io) io.emit('scheduleUpdated', { message: 'System Reset: All drivers reset.' });

        res.status(200).json({ msg: 'System reset successful.' });
    } catch (err) {
        console.error('Reset Error:', err.message);
        res.status(500).send('Server Error');
    }
};

// --- 7. UPDATE LOCATION & FUEL ---
exports.updateLocationAndFuel = async (req, res) => {
    try {
        const { driverId } = req.params;
        const { lat, lng } = req.body;

        if (typeof lat !== 'number' || typeof lng !== 'number') {
            return res.status(400).json({ message: 'Invalid coordinates' });
        }

        const driver = await Driver.findById(driverId);
        if (!driver) return res.status(404).json({ message: 'Driver not found' });

        const prev = (driver.currentLocation && driver.currentLocation.coordinates && driver.currentLocation.coordinates.length === 2)
            ? { lat: driver.currentLocation.coordinates[1], lng: driver.currentLocation.coordinates[0] }
            : { lat: WAREHOUSE_LOCATION.coordinates[1], lng: WAREHOUSE_LOCATION.coordinates[0] };

        function haversineKm(lat1, lon1, lat2, lon2) {
            const R = 6371;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        }

        const distanceKm = haversineKm(prev.lat, prev.lng, lat, lng);
        const maxRange = driver.maxRange || 150;
        const loadFactor = (driver.currentLoad || 0) / (driver.maxCapacity || 50);
        const consumptionPercent = Math.min(100, (distanceKm / Math.max(1, maxRange)) * 100 * (1 + loadFactor * 0.35));

        let newFuel = (typeof driver.fuelLevel === 'number' ? driver.fuelLevel : 100) - consumptionPercent;
        if (newFuel < 0) newFuel = 0;

        driver.fuelLevel = Math.round(newFuel * 10) / 10;
        driver.currentLocation = { type: 'Point', coordinates: [lng, lat] };
        await driver.save();

        const io = req.app.get('socketio');
        if (io) io.emit('driverLocationUpdated', driver);

        let stations = [];

        // ── LOW FUEL (<=25%): find nearby stations via ORS POI API ────────────────
        if (driver.fuelLevel <= 25) {
            try {
                const poisUrl = 'https://api.openrouteservice.org/pois';
                const poisRes = await axios.post(poisUrl, {
                    request: 'pois',
                    geometry: {
                        bbox: [[lng - 0.05, lat - 0.05], [lng + 0.05, lat + 0.05]],
                        geojson: { type: 'Point', coordinates: [lng, lat] },
                        buffer: 5000  // 5km radius in metres
                    },
                    filters: { category_ids: { 569: [] } },  // 569 = fuel stations in ORS
                    limit: 5
                }, {
                    headers: { 'Authorization': ORS_KEY, 'Content-Type': 'application/json' },
                    timeout: 8000
                });

                if (poisRes.data.features && poisRes.data.features.length > 0) {
                    stations = poisRes.data.features.map((f, idx) => {
                        const [sLng, sLat] = f.geometry.coordinates;
                        const dist = haversineKm(lat, lng, sLat, sLng);
                        return {
                            id: `ors_station_${idx}`,
                            name: f.properties?.osm_tags?.name || `Fuel Station ${idx + 1}`,
                            coordinates: [sLat, sLng],
                            lat: sLat, lng: sLng,
                            distance_km: parseFloat(dist.toFixed(2))
                        };
                    }).sort((a, b) => a.distance_km - b.distance_km);
                }
            } catch (poisErr) {
                console.warn('[ORS POI] Fuel station lookup failed:', poisErr.message);
                // Fallback to geometric approximations
                const offsets = [[0.01, 0], [-0.008, 0.006], [0, -0.01]];
                stations = offsets.map((off, idx) => {
                    const sLat = lat + off[0], sLng = lng + off[1];
                    return { id: `station_${idx}`, name: `Fuel Station ${idx + 1}`, coordinates: [sLat, sLng], lat: sLat, lng: sLng, distance_km: parseFloat(haversineKm(lat, lng, sLat, sLng).toFixed(2)) };
                });
            }

            if (io) io.emit('fuelAlert', { driverId: driver._id, fuelLevel: driver.fuelLevel, stations });

            // ── CRITICAL FUEL (0%): get ORS detour route to nearest station + admin alert
            if (driver.fuelLevel <= 0 && stations.length > 0) {
                const nearest = stations[0];
                let detourPolyline = [[lat, lng], [nearest.lat, nearest.lng]];
                try {
                    const dirRes = await axios.post('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
                        coordinates: [[lng, lat], [nearest.lng, nearest.lat]]
                    }, {
                        headers: { 'Authorization': ORS_KEY, 'Content-Type': 'application/json' },
                        timeout: 8000
                    });
                    if (dirRes.data.features?.[0]?.geometry?.coordinates) {
                        detourPolyline = dirRes.data.features[0].geometry.coordinates.map(([lo, la]) => [la, lo]);
                    }
                } catch (dirErr) { console.warn('[ORS Detour] Failed:', dirErr.message); }

                if (io) io.emit('criticalFuelAlert', {
                    driverId: driver._id,
                    driverName: driver.name,
                    fuelLevel: 0,
                    nearestStation: nearest,
                    detourPolyline,
                    message: `🚨 CRITICAL: ${driver.name} has 0% fuel! Nearest station: ${nearest.name} (${nearest.distance_km} km)`
                });
            }
        }

        res.status(200).json({ driver, stations });

    } catch (err) {
        console.error('Error in updateLocationAndFuel:', err.message);
        res.status(500).json({ message: 'Failed to update location and fuel' });
    }
};

// --- 7b. UPDATE LOCATION ONLY (30s heartbeat — no fuel recalc) ---
exports.updateLocationOnly = async (req, res) => {
    try {
        const { driverId } = req.params;
        const { lat, lng } = req.body;
        if (typeof lat !== 'number' || typeof lng !== 'number') {
            return res.status(400).json({ message: 'Invalid coordinates' });
        }
        const driver = await Driver.findByIdAndUpdate(
            driverId,
            { currentLocation: { type: 'Point', coordinates: [lng, lat] } },
            { new: true }
        );
        if (!driver) return res.status(404).json({ message: 'Driver not found' });
        const io = req.app.get('socketio');
        if (io) io.emit('driverLocationUpdated', driver);
        res.status(200).json({ ok: true, lat, lng });
    } catch (err) {
        console.error('updateLocationOnly error:', err.message);
        res.status(500).json({ message: 'Failed to update location' });
    }
};

// --- 8. REFUEL DRIVER ---
exports.refuelDriver = async (req, res) => {
    try {
        const { driverId } = req.params;
        const driver = await Driver.findByIdAndUpdate(
            driverId,
            { fuelLevel: 100 },
            { new: true }
        );
        if (!driver) return res.status(404).json({ msg: 'Driver not found' });

        const io = req.app.get('socketio');
        if (io) {
            io.emit('driverLocationUpdated', driver);
            io.emit('scheduleUpdated', { message: `⛽ ${driver.name} refuelled to 100%.` });
        }
        res.status(200).json(driver);
    } catch (err) {
        console.error('Refuel error:', err.message);
        res.status(500).send('Server Error');
    }
};

// --- 9. DRAIN FUEL (time-based simulation) ---
// Called by admin frontend on an interval for on-route drivers
exports.drainFuel = async (req, res) => {
    try {
        const { driverId } = req.params;
        const { amount } = req.body;   // percent to drain (0-100)
        const drain = Math.min(Math.max(parseFloat(amount) || 1, 0.1), 20);

        const driver = await Driver.findById(driverId);
        if (!driver) return res.status(404).json({ msg: 'Driver not found' });

        let newFuel = (typeof driver.fuelLevel === 'number' ? driver.fuelLevel : 100) - drain;
        if (newFuel < 0) newFuel = 0;
        driver.fuelLevel = Math.round(newFuel * 10) / 10;
        await driver.save();

        const io = req.app.get('socketio');
        if (io) {
            io.emit('driverLocationUpdated', driver);
            if (driver.fuelLevel <= 25) {
                io.emit('fuelAlert', { driverId: driver._id, fuelLevel: driver.fuelLevel, stations: [] });
            }
        }
        res.status(200).json(driver);
    } catch (err) {
        console.error('Drain fuel error:', err.message);
        res.status(500).send('Server Error');
    }
};