const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [80.2707, 13.0827] }
}, { _id: false });

const driverSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    vehicleType: { type: String, default: 'Bike' },
    vehicleSize: { type: String, enum: ['small', 'medium', 'large'], default: 'small' },
    license: { type: String, default: 'N/A' },
    
    // --- NEW AI FIELDS ---
    maxCapacity: { type: Number, default: 30 }, // kg
    maxRange: { type: Number, default: 100 },   // km
    // ---------------------

    isAvailable: { type: Boolean, default: true },
    currentLocation: { type: locationSchema, index: '2dsphere' },
    assignedZone: { type: String, default: 'Unzoned' }
}, { timestamps: true });

module.exports = mongoose.model('Driver', driverSchema);