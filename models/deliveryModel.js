const mongoose = require('mongoose');

const DeliverySchema = new mongoose.Schema({
  // Existing fields
  pickupLocation: {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },
  dropoffLocation: {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true }
  },
  status: {
    type: String,
    enum: ['pending', 'assigned', 'in_transit', 'delivered', 'failed', 'archived'],
    default: 'pending'
  },
  assignedDriver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver'
  },
  statusHistory: [{
    status: String,
    timestamp: Date
  }],
  
  // New/Updated fields for history tracking
  createdAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  }
});

DeliverySchema.index({ pickupLocation: '2dsphere' });

module.exports = mongoose.model('Delivery', DeliverySchema);
