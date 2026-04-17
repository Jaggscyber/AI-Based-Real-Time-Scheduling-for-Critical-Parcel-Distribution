const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [80.2707, 13.0827] } // [Lng, Lat]
}, { _id: false });

const driverSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    phone: { type: String, default: '000-000-0000' },
    
    // --- VEHICLE SPECS ---
    vehicleType: { type: String, enum: ['Bike', 'Truck', 'Heavy Truck'], default: 'Truck' },
    vehicleSize: { type: String, enum: ['small', 'medium', 'large'], default: 'medium' }, 
    maxCapacity: { type: Number, default: 50 }, // Max weight in kg
    maxRange: { type: Number, default: 150 },   // Max range in km
    
    // --- REAL-TIME STATUS ---
    fuelLevel: { type: Number, default: 100 },  // Percentage 0-100
    currentLoad: { type: Number, default: 0 },  // Current payload weight
    isAvailable: { type: Boolean, default: true },
    currentLocation: { type: locationSchema, index: '2dsphere' },
    assignedZone: { type: String, default: 'Unzoned' },
    license: { type: String, default: 'N/A' }
}, { timestamps: true });

module.exports = mongoose.model('Driver', driverSchema);