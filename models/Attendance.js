const mongoose = require('mongoose');

const locationPointSchema = new mongoose.Schema(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    capturedAt: { type: Date, required: true },
  },
  { _id: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    dateKey: { type: String, required: true, trim: true, index: true },
    checkIn: { type: locationPointSchema, default: null },
    checkOut: { type: locationPointSchema, default: null },
  },
  { timestamps: true }
);

attendanceSchema.index({ user: 1, dateKey: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
