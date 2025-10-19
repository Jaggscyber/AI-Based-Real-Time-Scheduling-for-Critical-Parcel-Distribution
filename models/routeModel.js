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
    enum: ['pending', 'assigned', 'in_progress', 'completed'], 
    default: 'pending',
  },
  polyline: String,
  totalDistance: String,
  totalDuration: String,
  legs: [LegSchema],
}, { timestamps: true });

module.exports = mongoose.model('Route', RouteSchema);