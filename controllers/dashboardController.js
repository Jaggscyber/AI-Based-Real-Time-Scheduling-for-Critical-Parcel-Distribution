const Delivery = require('../models/deliveryModel');
const Driver = require('../models/driverModel');

/**
 * @desc    Get dashboard statistics for warehouse modal
 * @route   GET /api/dashboard/stats
 */
exports.getDashboardStats = async (req, res) => {
    try {
        // Use Promise.all to run queries in parallel
        const [deliveryStats, availableDrivers, busyDrivers] = await Promise.all([
            Delivery.aggregate([
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 }
                    }
                }
            ]),
            Driver.find({ isAvailable: true }).select('name'),
            Driver.find({ isAvailable: false }).select('name')
        ]);

        // Process delivery stats into a simple object
        const stats = {
            pending: 0,
            in_transit: 0,
            delivered: 0
        };

        deliveryStats.forEach(stat => {
            if (stat._id === 'assigned' || stat._id === 'in_transit') {
                stats.in_transit += stat.count;
            } else if (stats.hasOwnProperty(stat._id)) {
                stats[stat._id] = stat.count;
            }
        });

        res.status(200).json({
            deliveryStats: stats,
            availableDrivers,
            busyDrivers
        });

    } catch (err) {
        console.error('Error fetching dashboard stats:', err.message);
        res.status(500).send('Server Error');
    }
};