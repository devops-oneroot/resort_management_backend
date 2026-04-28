const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const cloudinary = require('../config/cloudinary');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(protect);

async function sendExpoPushNotification(pushToken, title, body, data = {}) {
  if (!pushToken) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: pushToken,
        sound: 'default',
        title,
        body,
        data,
      }),
    });
  } catch (error) {
    console.error('Push notification send failed');
  }
}

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;
    if (req.user.role === 'employee') {
      filter.assignedTo = req.user._id;
    } else if (req.user.role === 'admin' && !req.user.isMainAdmin && req.user.department) {
      const deptUsers = await User.find({ role: 'employee', department: req.user.department }).select('_id');
      filter.assignedTo = { $in: deptUsers.map((item) => item._id) };
    }

    const tickets = await Ticket.find(filter)
      .populate('createdBy', 'name phone role department')
      .populate('assignedTo', 'name phone role department')
      .sort({ createdAt: -1 });

    return res.json({ count: tickets.length, tickets });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch tickets' });
  }
});

router.post(
  '/',
  upload.single('image'),
  [
    body('title').notEmpty().withMessage('Title is required'),
    body('description').notEmpty().withMessage('Description is required'),
    body('assignedTo').notEmpty().withMessage('Assigned user is required'),
    body('status')
      .optional()
      .isIn(['pending', 'in_progress', 'completed'])
      .withMessage('Invalid status'),
    body('priority').optional().isIn(['low', 'medium', 'high']).withMessage('Invalid priority'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Only admin can create tickets' });
      }
      if (!req.file) {
        return res.status(400).json({ message: 'Image is mandatory' });
      }

      if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return res.status(500).json({ message: 'Cloudinary is not configured on server' });
      }

      const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      const uploadResult = await cloudinary.uploader.upload(base64Image, {
        folder: 'tickets',
      });

      const assignee = await User.findById(req.body.assignedTo).select('_id role department pushToken name');
      if (!assignee || assignee.role !== 'employee') {
        return res.status(400).json({ message: 'Assigned user must be an employee' });
      }
      if (!req.user.isMainAdmin && assignee.department !== req.user.department) {
        return res.status(400).json({ message: 'Department admin can assign only within their department' });
      }

      const ticket = await Ticket.create({
        title: req.body.title,
        description: req.body.description,
        status: 'pending',
        priority: req.body.priority,
        imageUrl: uploadResult.secure_url,
        assignedTo: req.body.assignedTo,
        createdBy: req.user._id,
      });

      await sendExpoPushNotification(
        assignee.pushToken,
        'New Ticket Assigned',
        `You have a new ticket: ${ticket.title}`,
        { ticketId: ticket._id.toString(), type: 'ticket_assigned' }
      );

      return res.status(201).json(ticket);
    } catch (error) {
      return res.status(500).json({ message: 'Failed to create ticket' });
    }
  }
);

router.put('/:id', async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only admin can update ticket details' });
    }

    const updatableFields = ['title', 'description', 'priority', 'assignedTo'];
    updatableFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        ticket[field] = req.body[field];
      }
    });

    if (!req.user.isMainAdmin && ticket.assignedTo) {
      const target = await User.findById(ticket.assignedTo).select('department');
      if (!target || target.department !== req.user.department) {
        return res.status(400).json({ message: 'Department admin can update only their department tickets' });
      }
    }

    const updatedTicket = await ticket.save();
    return res.json(updatedTicket);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update ticket' });
  }
});

router.patch('/:id/complete', upload.single('image'), async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const isMainAdmin = req.user.role === 'admin' && req.user.isMainAdmin;
    const isAssignee = ticket.assignedTo && ticket.assignedTo.toString() === req.user._id.toString();
    if (!isMainAdmin && !isAssignee) {
      return res.status(403).json({ message: 'Only assigned user or main admin can complete this ticket' });
    }
    if (ticket.status !== 'in_progress') {
      return res.status(400).json({ message: 'Start work before completing ticket' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'Completion image is mandatory' });
    }

    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const uploadResult = await cloudinary.uploader.upload(base64Image, {
      folder: 'tickets/completed',
    });
    ticket.status = 'completed';
    ticket.completionImageUrl = uploadResult.secure_url;
    const updatedTicket = await ticket.save();
    return res.json(updatedTicket);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to complete ticket' });
  }
});

router.patch('/:id/start', async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    if (ticket.status === 'completed') {
      return res.status(400).json({ message: 'Completed ticket cannot be started again' });
    }
    if (ticket.status === 'in_progress') {
      return res.status(400).json({ message: 'Ticket is already in progress' });
    }

    const isMainAdmin = req.user.role === 'admin' && req.user.isMainAdmin;
    const isAssignee = ticket.assignedTo && ticket.assignedTo.toString() === req.user._id.toString();
    if (!isMainAdmin && !isAssignee) {
      return res.status(403).json({ message: 'Only assigned user or main admin can start this ticket' });
    }

    ticket.status = 'in_progress';
    const updatedTicket = await ticket.save();
    return res.json(updatedTicket);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to start ticket' });
  }
});

router.patch('/:id/reassign', async (req, res) => {
  try {
    const { assignedTo } = req.body;
    if (!assignedTo) {
      return res.status(400).json({ message: 'assignedTo is required' });
    }

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
    if (ticket.status === 'completed') {
      return res.status(400).json({ message: 'Cannot reassign completed ticket' });
    }

    if (req.user.role !== 'employee') {
      return res.status(403).json({ message: 'Only assigned employee can reassign this ticket' });
    }

    const isCurrentAssignee =
      ticket.assignedTo && ticket.assignedTo.toString() === req.user._id.toString();
    if (!isCurrentAssignee) {
      return res.status(403).json({ message: 'Only current assigned employee can reassign this ticket' });
    }

    const targetUser = await User.findById(assignedTo).select('_id role department pushToken name');
    if (!targetUser || targetUser.role !== 'employee') {
      return res.status(400).json({ message: 'Target user must be an employee' });
    }
    if (!req.user.department || targetUser.department !== req.user.department) {
      return res.status(400).json({ message: 'Can only reassign to same department employee' });
    }

    ticket.assignedTo = targetUser._id;
    const updatedTicket = await ticket.save();
    await sendExpoPushNotification(
      targetUser.pushToken,
      'Ticket Reassigned',
      `A ticket has been reassigned to you: ${updatedTicket.title}`,
      { ticketId: updatedTicket._id.toString(), type: 'ticket_reassigned' }
    );
    return res.json(updatedTicket);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to reassign ticket' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    await ticket.deleteOne();
    return res.json({ message: 'Ticket deleted' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete ticket' });
  }
});

module.exports = router;
