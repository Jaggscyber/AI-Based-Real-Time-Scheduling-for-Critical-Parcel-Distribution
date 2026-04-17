const Delivery = require('../models/deliveryModel');
const Driver = require('../models/driverModel');

exports.getWarehouseDetails = async (req, res) => {
    try {
        const [deliveryStatsAggregation, drivers] = await Promise.all([
            Delivery.aggregate([
                { $match: { status: { $ne: 'archived' } } },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            Driver.find({ name: { $exists: true, $ne: "" } }, 'name isAvailable')
        ]);

        const deliveryStats = { pending: 0, assigned: 0, in_transit: 0, delivered: 0, failed: 0 };
        deliveryStatsAggregation.forEach(stat => {
            if (deliveryStats.hasOwnProperty(stat._id)) deliveryStats[stat._id] = stat.count;
        });

        res.status(200).json({
            deliveryStats,
            driverDetails: drivers,
            totalDrivers: drivers.length,
            totalActiveDeliveries: deliveryStats.assigned + deliveryStats.in_transit
        });
    } catch (err) {
        console.error('Error fetching dashboard details:', err.message);
        res.status(500).send('Server Error');
    }
};

// GET /api/dashboard/driver-performance
exports.getDriverPerformance = async (req, res) => {
    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const completed = await Delivery.find({
            status: 'delivered',
            completedAt: { $gte: sevenDaysAgo }
        }).populate('assignedDriver', 'name vehicleType');

        // Group by driverId
        const driverMap = {};
        for (const d of completed) {
            if (!d.assignedDriver) continue;
            const dId = String(d.assignedDriver._id);
            if (!driverMap[dId]) {
                driverMap[dId] = {
                    driverId: dId,
                    driverName: d.assignedDriver.name,
                    vehicleType: d.assignedDriver.vehicleType,
                    deliveries: []
                };
            }
            driverMap[dId].deliveries.push(d);
        }

        const performance = Object.values(driverMap).map(entry => {
            const { driverId, driverName, vehicleType, deliveries } = entry;
            const totalCompleted = deliveries.length;
            let onTimeCount = 0, totalDeliveryMinutes = 0, totalDistKm = 0;

            for (const del of deliveries) {
                const created = new Date(del.createdAt);
                const done = new Date(del.completedAt);
                const minutesTaken = (done - created) / 60000;
                totalDeliveryMinutes += minutesTaken;

                // Check against deadline (relative to shift start 8am)
                const shiftStart = new Date(created);
                shiftStart.setHours(8, 0, 0, 0);
                const deadlineTime = new Date(shiftStart.getTime() + (del.deadline || 480) * 60000);
                if (done <= deadlineTime) onTimeCount++;

                // Estimate distance: ~3 min/km average in Chennai
                totalDistKm += minutesTaken / 3;
            }

            const onTimeRate = totalCompleted > 0 ? Math.round((onTimeCount / totalCompleted) * 100) : 0;
            const avgDeliveryMins = totalCompleted > 0 ? Math.round(totalDeliveryMinutes / totalCompleted) : 0;
            const fuelUsed = vehicleType === 'EV'
                ? `${(totalDistKm * 0.18).toFixed(1)} kWh`
                : `${(totalDistKm * 0.085).toFixed(1)} L`;

            return { driverId, driverName, vehicleType, onTimeRate, avgDeliveryMins, totalCompleted, fuelUsed, totalDistKm: Math.round(totalDistKm) };
        });

        performance.sort((a, b) => b.onTimeRate - a.onTimeRate);
        res.status(200).json(performance);
    } catch (err) {
        console.error('Driver Performance Error:', err.message);
        res.status(500).send('Server Error');
    }
};

// GET /api/dashboard/sla-breaches
exports.checkSLABreaches = async (req, res) => {
    try {
        const active = await Delivery.find({
            status: { $in: ['assigned', 'in_transit'] }
        }).populate('assignedDriver', 'name');

        const now = Date.now();
        const breaches = [];

        for (const del of active) {
            const created = new Date(del.createdAt);
            const shiftStart = new Date(created);
            shiftStart.setHours(8, 0, 0, 0);
            const deadlineMs = (del.deadline || 480) * 60 * 1000;
            const deadlineTime = new Date(shiftStart.getTime() + deadlineMs);
            const minsRemaining = (deadlineTime - now) / 60000;
            const minsElapsed = (now - shiftStart) / 60000;
            const pctElapsed = minsElapsed / (del.deadline || 480);

            if (pctElapsed >= 0.85 || minsRemaining < 60) {
                breaches.push({
                    deliveryId: del._id,
                    customerName: del.customerName,
                    driverName: del.assignedDriver?.name || 'Unassigned',
                    driverId: del.assignedDriver?._id,
                    minsRemaining: Math.round(minsRemaining),
                    emergency: del.emergency,
                    status: del.status
                });
            }
        }

        breaches.sort((a, b) => a.minsRemaining - b.minsRemaining);
        res.status(200).json(breaches);
    } catch (err) {
        console.error('SLA Check Error:', err.message);
        res.status(500).send('Server Error');
    }
};