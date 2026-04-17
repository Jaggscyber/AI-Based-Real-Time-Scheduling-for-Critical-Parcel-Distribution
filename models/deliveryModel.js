const mongoose = require('mongoose');

const DeliverySchema = new mongoose.Schema({
  pickupLocation: {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true } // [lng, lat]
  },
  dropoffLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number] }
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
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  fullAddress: { type: String, default: '' },

  // --- NEW AI FIELDS ---
  zone: { type: String, default: 'Unzoned' },
  items: [{ type: String }],
  cost: { type: Number, default: 0 },

  // Weight in kg (Default 5kg)
  weight: { type: Number, default: 5 },

  // Area (urban, suburban, rural)
  area: { type: String, enum: ['urban', 'suburban', 'rural'], default: 'urban' },

  // Emergency delivery (medicine, urgent items)
  emergency: { type: Boolean, default: false },

  // Time Window in Minutes from 8:00 AM (e.g., 60 = 9:00 AM)
  deadline: { type: Number, default: 480 }, // Default 4:00 PM (8hrs * 60)
  // ---------------------

  statusHistory: [{ status: String, timestamp: Date }],
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date },

  // --- OTP VERIFICATION ---
  otp: { type: String, default: null },           // 4-digit code shown to customer
  otpVerified: { type: Boolean, default: false },  // true once driver confirms
  // ------------------------
});

DeliverySchema.index({ pickupLocation: '2dsphere' });
// Compound indexes for faster SLA + schedule queries
DeliverySchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Delivery', DeliverySchema);