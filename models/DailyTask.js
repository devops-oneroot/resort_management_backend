const mongoose = require('mongoose');

const dailyTaskSchema = new mongoose.Schema(
  {
    taskTitle: {
      type: String,
      required: true,
      trim: true,
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    department: {
      type: String,
      required: true,
      trim: true,
    },
    dateKey: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['started', 'completed'],
      default: 'started',
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      default: null,
    },
    startImageUrl: {
      type: String,
      required: true,
      trim: true,
    },
    startVoiceUrl: {
      type: String,
      default: null,
      trim: true,
    },
    endImageUrl: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { timestamps: true }
);

dailyTaskSchema.index({ employee: 1, dateKey: 1, startTime: -1 });
dailyTaskSchema.index({ department: 1, dateKey: 1, startTime: -1 });

module.exports = mongoose.model('DailyTask', dailyTaskSchema);
