// models/routeModel.js
const mongoose = require('mongoose');

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
    enum: ['pending', 'in_progress', 'completed'],
    default: 'pending',
  },
}, { timestamps: true });

module.exports = mongoose.model('Route', RouteSchema);