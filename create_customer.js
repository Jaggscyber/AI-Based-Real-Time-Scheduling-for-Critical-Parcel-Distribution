const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/userModel');
require('dotenv').config();

const createCustomer = async () => {
    try {
        const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/parcel_distribution_ai';
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to DB');

        const email = 'customer@mail.com';
        const password = 'password123';

        // Check if exists
        const existing = await User.findOne({ email });
        if (existing) {
            console.log('⚠️ User already exists.');
            console.log('Login with -> Email:', email, ' Password:', password);
            process.exit();
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const customer = new User({
            name: "Rahul Customer",
            email: email,
            password: hashedPassword,
            role: "customer", // This matches the enum in userModel.js
            address: "123 Main St, Chennai"
        });

        await customer.save();
        console.log('🎉 Customer Account Created!');
        console.log('👉 Email:', email);
        console.log('👉 Password:', password);
        process.exit();

    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

createCustomer();