const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      required: true,
      trim: true,
    },
    completionImageUrl: {
      type: String,
      default: null,
      trim: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed'],
      default: 'pending',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assignmentHistory: [
      {
        assignedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        assignedTo: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        department: {
          type: String,
          default: null,
          trim: true,
        },
        assignedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    roomInspection: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RoomInspection',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Ticket', ticketSchema);
