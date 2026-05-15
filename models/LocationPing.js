const mongoose = require('mongoose');

const locationPingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    dateKey: { type: String, required: true, trim: true, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracy: { type: Number, default: null },
    capturedAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

locationPingSchema.index({ user: 1, dateKey: 1, capturedAt: -1 });
locationPingSchema.index({ dateKey: 1, capturedAt: -1 });

module.exports = mongoose.model('LocationPing', locationPingSchema);
