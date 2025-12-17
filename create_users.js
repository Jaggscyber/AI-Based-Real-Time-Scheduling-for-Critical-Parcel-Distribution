const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const Driver = require('./models/driverModel');
const User = require('./models/userModel');

// Load environment variables
dotenv.config();

const createUsersForDrivers = async () => {
    try {
        // 1. Connect to MongoDB
        const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/parcel_distribution_ai';
        await mongoose.connect(MONGO_URI);
        console.log('✅ MongoDB Connected');

        // 2. Fetch all drivers
        const drivers = await Driver.find({});
        console.log(`🔍 Found ${drivers.length} drivers. Checking for missing logins...`);

        const salt = await bcrypt.genSalt(10);
        const defaultPassword = await bcrypt.hash('password123', salt); // Default password

        let createdCount = 0;

        for (const driver of drivers) {
            // Fix: If driver has no email (dummy data), generate one
            let driverEmail = driver.email;
            let needsSave = false;

            if (!driverEmail) {
                const sanitizedName = driver.name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '');
                driverEmail = `${sanitizedName}@driver.com`;
                driver.email = driverEmail;
                needsSave = true;
                console.log(`⚠️ Driver ${driver.name} had no email. Generated: ${driverEmail}`);
            }

            // Check if User exists
            const existingUser = await User.findOne({ email: driverEmail });

            if (!existingUser) {
                // Create new User Login
                const newUser = new User({
                    name: driver.name,
                    email: driverEmail,
                    password: defaultPassword,
                    role: 'driver',
                    phone: '0000000000',
                    address: 'Registered via Script'
                });
                await newUser.save();
                createdCount++;
                console.log(`✅ Created Login for: ${driver.name} (${driverEmail})`);
            } else {
                console.log(`ℹ️ Login already exists for: ${driver.name}`);
            }

            // Save driver if we auto-generated an email
            if (needsSave) await driver.save();
        }

        console.log(`\n🎉 Process Complete! Created ${createdCount} new login accounts.`);
        console.log(`👉 Default Password for all new accounts: password123`);
        process.exit();

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

createUsersForDrivers();