const mongoose = require('mongoose');

const StatusHistorySchema = new mongoose.Schema({
    status: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
}, { _id: false });

const DeliverySchema = new mongoose.Schema({
  pickupLocation: {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true }
  },
  dropoffLocation: {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true }
  },
  status: {
    type: String,
    enum: ['pending', 'assigned', 'in_transit', 'delivered', 'failed'],
    default: 'pending'
  },
  assignedDriver: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Driver', 
    default: null 
  },
  size: {
    type: Number,
    default: 1
  },
  statusHistory: [StatusHistorySchema]
}, { timestamps: true });

DeliverySchema.pre('save', function(next) {
    if (this.isNew) {
        this.statusHistory.push({ status: 'pending' });
    }
    next();
});

module.exports = mongoose.model('Delivery', DeliverySchema);