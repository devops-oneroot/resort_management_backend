const mongoose = require('mongoose');

const checklistItemSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    isChecked: { type: Boolean, default: false },
  },
  { _id: false }
);

const assignmentHistorySchema = new mongoose.Schema(
  {
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const roomInspectionSchema = new mongoose.Schema(
  {
    inspectionDate: { type: String, required: true, trim: true },
    categoryKey: { type: String, required: true, trim: true },
    categoryName: { type: String, required: true, trim: true },
    roomNumber: { type: Number, required: true, min: 1 },
    roomLabel: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed'],
      default: 'pending',
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignmentHistory: { type: [assignmentHistorySchema], default: [] },
    checklist: { type: [checklistItemSchema], default: [] },
    notes: { type: String, default: '', trim: true },
    progressImageUrl: { type: String, default: null, trim: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

roomInspectionSchema.index({ inspectionDate: 1, categoryKey: 1, roomNumber: 1 }, { unique: true });

module.exports = mongoose.model('RoomInspection', roomInspectionSchema);
