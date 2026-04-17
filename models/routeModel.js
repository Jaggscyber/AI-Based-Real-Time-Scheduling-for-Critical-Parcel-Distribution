const mongoose = require('mongoose');

const LegSchema = new mongoose.Schema({
    start_address: String,
    end_address: String,
    distance: String,
    duration: String,
}, { _id: false });

const RouteSchema = new mongoose.Schema({
  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    required: true,
  },
  stops: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Delivery',
  }],
  status: {
    type: String,
    // CORRECTED ENUM to include all statuses used in the app
    enum: ['pending', 'assigned', 'in_progress', 'completed', 'broken_down'], 
    default: 'pending',
  },
  polyline: String,
  totalDistance: String,
  totalDuration: String,
  legs: [LegSchema],
  // NEW: Breakdown tracking
  breakdownPickup: { type: Boolean, default: false },
  originalDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
  breakdownLocation: { type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: [Number] },
  breakdownTime: Date,
  trafficImpactScore: { type: Number, default: 0 },
  optimizationVersion: { type: Number, default: 1 }
}, { timestamps: true });

module.exports = mongoose.model('Route', RouteSchema);