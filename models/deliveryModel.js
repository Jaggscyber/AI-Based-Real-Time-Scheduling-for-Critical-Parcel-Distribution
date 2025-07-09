// models/deliveryModel.js
const mongoose = require('mongoose');

const DeliverySchema = new mongoose.Schema({
  pickupLocation: {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },
  dropoffLocation: {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },
  status: {
    type: String,
    enum: ['pending', 'assigned', 'in_transit', 'delivered', 'failed'],
    default: 'pending'
  },
  priority: { type: Number, default: 1 }, // e.g., 1=low, 5=high
  assignedDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null },
  // ... other details like time constraints, recipient info etc.
}, { timestamps: true });

module.exports = mongoose.model('Delivery', DeliverySchema);