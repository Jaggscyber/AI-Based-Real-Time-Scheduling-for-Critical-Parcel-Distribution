const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Delivery = require('./models/deliveryModel');
const User = require('./models/userModel');
require('dotenv').config();

const createAllCustomers = async () => {
    try {
        // 1. Connect to Database
        const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/parcel_distribution_ai';
        await mongoose.connect(MONGO_URI);
        console.log('Connected to DB');

        // 2. Find all unique customers from Delivery History
        // We group by phone number to ensure unique users
        const uniqueCustomers = await Delivery.aggregate([
            {
                $group: {
                    _id: "$customerPhone", // Group by Phone Number
                    name: { $first: "$customerName" }, // Take the first name found
                    address: { $first: "$fullAddress" }
                }
            }
        ]);

        console.log(`🔍 Found ${uniqueCustomers.length} unique customers in delivery history.`);

        const salt = await bcrypt.genSalt(10);
        const defaultPassword = await bcrypt.hash('password123', salt);
        let createdCount = 0;

        // 3. Loop through and create User accounts
        for (const cust of uniqueCustomers) {
            const phone = cust._id;
            const name = cust.name;
            
            // Skip invalid data
            if (!phone || phone === "000-000-0000" || !name) continue;

            // Generate a dummy email for login: "phone@customer.com"
            // Example: 9876543210@customer.com
            const generatedEmail = `${phone.replace(/\D/g, '')}@customer.com`;

            // Check if User already exists
            const existingUser = await User.findOne({ 
                $or: [{ email: generatedEmail }, { phone: phone }] 
            });

            if (!existingUser) {
                const newUser = new User({
                    name: name,
                    email: generatedEmail,
                    password: defaultPassword,
                    phone: phone,
                    role: 'customer',
                    address: cust.address || "Registered via Script"
                });

                await newUser.save();
                createdCount++;
                console.log(`Created: ${name} | Login: ${generatedEmail}`);
            } else {
                console.log(`Exists: ${name}`);
            }
        }

        console.log(`\n🎉 Process Complete! Created ${createdCount} new customer accounts.`);
        console.log(`👉 Default Password: password123`);
        process.exit();

    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
};

createAllCustomers();