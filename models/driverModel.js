// models/driverModel.js
const mongoose = require('mongoose');

const DriverSchema = new mongoose.Schema({
  name: { type: String, required: true },
  currentLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], index: '2dsphere' } // [longitude, latitude]
  },
  isAvailable: { type: Boolean, default: true },
  // ... other driver details like vehicle capacity, contact etc.
}, { timestamps: true });

module.exports = mongoose.model('Driver', DriverSchema);