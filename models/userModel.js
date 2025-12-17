const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { 
        type: String, 
        required: true, 
        unique: true, 
        trim: true, 
        lowercase: true // <--- CRITICAL FIX
    },
    password: { type: String, required: true },
    role: { 
        type: String, 
        enum: ['admin', 'customer', 'driver'], 
        default: 'customer' 
    },
    phone: { type: String },
    address: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);