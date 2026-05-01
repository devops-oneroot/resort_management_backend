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

function normalizeDepartment(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

async function getAssignableUsersForRequester(requester, selectedDepartment) {
  const department = String(selectedDepartment || '').trim();
  const normalizedTarget = normalizeDepartment(department);
  if (!normalizedTarget) return [];

  if (requester.role === 'admin') {
    const ownDepartment = normalizeDepartment(requester.department);
    if (!requester.isMainAdmin) {
      if (!ownDepartment || ownDepartment !== normalizedTarget) {
        return [];
      }
      return User.find({
        department,
        role: 'employee',
      })
        .select('_id name role department pushToken')
        .sort({ name: 1 });
    }

    return User.find({
      department,
      role: { $in: ['admin', 'employee'] },
    })
      .select('_id name role department pushToken')
      .sort({ role: 1, name: 1 });
  }

  if (!requester.department) return [];
  const ownDepartment = normalizeDepartment(requester.department);

  if (ownDepartment === normalizedTarget) {
    return User.find({
      department,
      role: { $in: ['admin', 'employee'] },
    })
      .select('_id name role department pushToken')
      .sort({ role: 1, name: 1 });
  }

  return User.find({
    department,
    role: 'admin',
  })
    .select('_id name role department pushToken')
    .sort({ name: 1 });
}

async function sendExpoPushNotification(pushToken, title, body, data = {}) {
  if (!pushToken) {
    return { ok: false, reason: 'missing_push_token' };
  }
  const normalizedToken = String(pushToken).trim();
  if (!/^ExponentPushToken\[[^\]]+\]$/.test(normalizedToken) && !/^ExpoPushToken\[[^\]]+\]$/.test(normalizedToken)) {
    console.error('Invalid Expo push token format:', normalizedToken);
    return { ok: false, reason: 'invalid_push_token_format' };
  }
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: normalizedToken,
        sound: 'default',
        title,
        body,
        data,
      }),
    });
    const payload = await response.json().catch(() => null);
    const ticket = payload?.data;
    const items = Array.isArray(ticket) ? ticket : [ticket];
    const hasError = !response.ok || items.some((item) => item?.status === 'error');
    if (hasError) {
      console.error('Expo push send failed:', {
        responseStatus: response.status,
        responseBody: payload,
      });
      return { ok: false, reason: 'expo_rejected', details: payload };
    }
    return { ok: true };
  } catch (error) {
    console.error('Push notification send failed', error);
    return { ok: false, reason: 'network_error', details: String(error) };
  }
}

router.get('/', async (req, res) => {
  try {
    const filter = {};
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const skip = (page - 1) * limit;

    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;
    if (req.user.role === 'employee') {
      filter.$or = [{ assignedTo: req.user._id }, { createdBy: req.user._id }];
    } else if (req.user.role === 'admin' && !req.user.isMainAdmin && req.user.department) {
      const deptUsers = await User.find({ department: req.user.department }).select('_id');
      filter.assignedTo = { $in: deptUsers.map((item) => item._id) };
    }

    const [tickets, totalCount] = await Promise.all([
      Ticket.find(filter)
        .populate('createdBy', 'name phone role department')
        .populate('assignedTo', 'name phone role department')
        .populate('assignmentHistory.assignedBy', 'name role department')
        .populate('assignmentHistory.assignedTo', 'name role department')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Ticket.countDocuments(filter),
    ]);

    const totalPages = Math.max(Math.ceil(totalCount / limit), 1);

    return res.json({
      count: tickets.length,
      totalCount,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      tickets,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch tickets' });
  }
});

router.get('/assignable-users', async (req, res) => {
  try {
    const department = String(req.query.department || '').trim();
    if (!department) {
      return res.status(400).json({ message: 'department is required' });
    }

    const users = await getAssignableUsersForRequester(req.user, department);
    return res.json({ count: users.length, users });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch assignable users' });
  }
});

router.post(
  '/',
  upload.single('image'),
  [
    body('title').notEmpty().withMessage('Title is required'),
    body('description').notEmpty().withMessage('Description is required'),
    body('department').notEmpty().withMessage('Department is required'),
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

      const selectedDepartment = String(req.body.department || '').trim();
      const assignee = await User.findById(req.body.assignedTo).select('_id role department pushToken name');
      if (!assignee) {
        return res.status(400).json({ message: 'Assigned user not found' });
      }

      const assignableUsers = await getAssignableUsersForRequester(req.user, selectedDepartment);
      const isAllowed = assignableUsers.some((user) => user._id.toString() === assignee._id.toString());
      if (!isAllowed) {
        return res.status(400).json({ message: 'Selected assignee is not allowed for this department' });
      }

      const ticket = await Ticket.create({
        title: req.body.title,
        description: req.body.description,
        status: 'pending',
        priority: req.body.priority,
        imageUrl: uploadResult.secure_url,
        assignedTo: req.body.assignedTo,
        createdBy: req.user._id,
        assignmentHistory: [
          {
            assignedBy: req.user._id,
            assignedTo: req.body.assignedTo,
            department: selectedDepartment,
            assignedAt: new Date(),
          },
        ],
      });

      const pushResult = await sendExpoPushNotification(
        assignee.pushToken,
        'New Ticket Assigned',
        `You have a new ticket: ${ticket.title}`,
        { ticketId: ticket._id.toString(), type: 'ticket_assigned' }
      );
      if (!pushResult?.ok) {
        console.error('Ticket assignment push not delivered', {
          assigneeId: assignee._id?.toString(),
          reason: pushResult?.reason,
        });
      }

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
    ticket.completedAt = new Date();
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

    const isCurrentAssignee =
      ticket.assignedTo && ticket.assignedTo.toString() === req.user._id.toString();
    if (req.user.role !== 'admin' && !isCurrentAssignee) {
      return res.status(403).json({ message: 'Only assigned employee or admin can reassign this ticket' });
    }

    const targetUser = await User.findById(assignedTo).select('_id role department pushToken name');
    if (!targetUser) {
      return res.status(400).json({ message: 'Target user not found' });
    }
    const selectedDepartment = String(req.body.department || targetUser.department || '').trim();
    const assignableUsers = await getAssignableUsersForRequester(req.user, selectedDepartment);
    const isAllowed = assignableUsers.some((user) => user._id.toString() === targetUser._id.toString());
    if (!isAllowed) {
      return res.status(400).json({ message: 'Selected reassignment target is not allowed' });
    }

    ticket.assignedTo = targetUser._id;
    ticket.assignmentHistory.push({
      assignedBy: req.user._id,
      assignedTo: targetUser._id,
      department: selectedDepartment,
      assignedAt: new Date(),
    });
    const updatedTicket = await ticket.save();
    const pushResult = await sendExpoPushNotification(
      targetUser.pushToken,
      'Ticket Reassigned',
      `A ticket has been reassigned to you: ${updatedTicket.title}`,
      { ticketId: updatedTicket._id.toString(), type: 'ticket_reassigned' }
    );
    if (!pushResult?.ok) {
      console.error('Ticket reassignment push not delivered', {
        targetUserId: targetUser._id?.toString(),
        reason: pushResult?.reason,
      });
    }
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
