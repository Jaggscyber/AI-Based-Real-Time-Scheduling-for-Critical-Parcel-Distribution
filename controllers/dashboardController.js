const Delivery = require('../models/deliveryModel');
const Driver = require('../models/driverModel');

exports.getWarehouseDetails = async (req, res) => {
    try {
        const [deliveryStatsAggregation, drivers] = await Promise.all([
            Delivery.aggregate([
                { $match: { status: { $ne: 'archived' } } },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            Driver.find({ name: { $exists: true, $ne: "" } }, 'name isAvailable') // Only find named drivers
        ]);

        const deliveryStats = { pending: 0, assigned: 0, in_transit: 0, delivered: 0, failed: 0 };
        deliveryStatsAggregation.forEach(stat => {
            if (deliveryStats.hasOwnProperty(stat._id)) {
                deliveryStats[stat._id] = stat.count;
            }
        });
        
        const totalActiveDeliveries = deliveryStats.assigned + deliveryStats.in_transit;

        res.status(200).json({
            deliveryStats,
            driverDetails: drivers,
            totalDrivers: drivers.length,
            totalActiveDeliveries
        });

    } catch (err) {
        console.error('Error fetching dashboard details:', err.message);
        res.status(500).send('Server Error');
    }
};