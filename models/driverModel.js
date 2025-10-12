const mongoose = require('mongoose');

const DriverSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    unique: true // <-- Prevents duplicate driver names
  },
  currentLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], index: '2dsphere' }
  },
  isAvailable: { type: Boolean, default: true },
  vehicleCapacity: { type: Number, default: 50 }
}, { timestamps: true });

module.exports = mongoose.model('Driver', DriverSchema);

