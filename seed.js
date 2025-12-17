const mongoose = require('mongoose');
const Driver = require('./models/driverModel');
const Delivery = require('./models/deliveryModel');
const User = require('./models/userModel');
const Route = require('./models/routeModel');

const seedData = async () => {
    try {
        console.log('🌱 Starting Database Seed...');

        // 1. CLEAR EXISTING DATA
        await Driver.deleteMany({});
        await Delivery.deleteMany({});
        await Route.deleteMany({});
        // await User.deleteMany({}); // Optional: Reset users
        console.log('🧹 Old data cleared.');

        // 2. CREATE DRIVERS
        const drivers = await Driver.insertMany([
            {
                name: "Ravi Kumar",
                email: "ravi@test.com",
                vehicleType: "Truck",
                license: "DL-101010",
                isAvailable: true,
                currentLocation: { type: 'Point', coordinates: [80.2707, 13.0827] }, // Chennai
                assignedZone: "North Chennai"
            },
            {
                name: "Priya Sharma",
                email: "priya@test.com",
                vehicleType: "Van",
                license: "DL-202020",
                isAvailable: true,
                currentLocation: { type: 'Point', coordinates: [80.2500, 13.0500] },
                assignedZone: "South Chennai"
            },
            {
                name: "Amit Singh",
                email: "amit@test.com",
                vehicleType: "Bike",
                license: "DL-303030",
                isAvailable: false, // Busy
                currentLocation: { type: 'Point', coordinates: [80.2100, 13.0100] },
                assignedZone: "West Chennai"
            }
        ]);
        console.log(`✅ Added ${drivers.length} Drivers`);

        // 3. CREATE DELIVERIES
        const deliveries = await Delivery.insertMany([
            {
                customerName: "Alice Electronics",
                customerPhone: "9876543210",
                pickupLocation: { type: 'Point', coordinates: [80.2800, 13.0900] },
                dropoffLocation: { type: 'Point', coordinates: [80.2900, 13.1000] },
                status: "pending",
                fullAddress: "123 Electronics St, North Chennai",
                items: ["Laptop", "Mouse"],
                cost: 150,
                zone: "North Chennai"
            },
            {
                customerName: "Bob's Bakery",
                customerPhone: "8765432109",
                pickupLocation: { type: 'Point', coordinates: [80.2600, 13.0600] },
                dropoffLocation: { type: 'Point', coordinates: [80.2700, 13.0700] },
                status: "pending",
                fullAddress: "456 Baker St, South Chennai",
                items: ["Flour", "Sugar"],
                cost: 80,
                zone: "South Chennai"
            },
            {
                customerName: "Charlie Home",
                customerPhone: "7654321098",
                pickupLocation: { type: 'Point', coordinates: [80.2200, 13.0200] },
                dropoffLocation: { type: 'Point', coordinates: [80.2300, 13.0300] },
                status: "assigned", // Already assigned
                assignedDriver: drivers[2]._id, // Assigned to Amit
                fullAddress: "789 Home Ave, West Chennai",
                items: ["Furniture"],
                cost: 500,
                zone: "West Chennai"
            }
        ]);
        console.log(`✅ Added ${deliveries.length} Deliveries`);
        console.log('🎉 Seeding Complete!');
        
    } catch (error) {
        console.error('❌ Seeding Error:', error);
    }
};

module.exports = seedData;