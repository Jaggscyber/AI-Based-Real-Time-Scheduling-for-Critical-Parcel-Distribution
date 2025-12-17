const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Driver = require('../models/driverModel');
const User = require('../models/userModel');
require('dotenv').config({ path: '../.env' }); // Adjust path to your .env

const migrate = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ DB Connected');

        const drivers = await Driver.find({});
        console.log(`Found ${drivers.length} drivers.`);

        for (const driver of drivers) {
            // Check if a User login already exists
            const exists = await User.findOne({ email: driver.email });
            if (!exists) {
                const hashedPassword = await bcrypt.hash("driver123", 10);
                
                await User.create({
                    name: driver.name,
                    email: driver.email,
                    password: hashedPassword,
                    role: 'driver',
                    phone: driver.license || '0000000000'
                });
                console.log(`Created Login for: ${driver.name}`);
            } else {
                console.log(`Login already exists for: ${driver.name}`);
            }
        }
        console.log('🎉 Migration Complete. Drivers can login with email + "driver123"');
        process.exit();
    } catch (error) {
        console.error("Migration Error:", error);
        process.exit(1);
    }
};

migrate();