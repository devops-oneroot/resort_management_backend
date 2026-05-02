const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');

const RoomInspection = require('../models/RoomInspection');
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const cloudinary = require('../config/cloudinary');
const { protect } = require('../middleware/authMiddleware');
const {
  ROOM_CATEGORIES,
  getChecklistForCategory,
  buildRoomLabel,
} = require('../config/roomInspectionConfig');

const router = express.Router();
router.use(protect);
const upload = multer({ storage: multer.memoryStorage() });

function toDateKey(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeDepartment(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeDepartmentLoose(value) {
  return normalizeDepartment(value).replace(/\s+/g, ' ');
}

function monthKeyFromDate(dateKey) {
  return String(dateKey || '').slice(0, 7);
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
    const dataNode = payload?.data;
    const tickets = Array.isArray(dataNode) ? dataNode : [dataNode];
    const hasError = !response.ok || tickets.some((item) => item?.status === 'error');
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

function resolveAssignedAdminId(inspectionDoc) {
  if (inspectionDoc.assignedBy) return inspectionDoc.assignedBy.toString();
  const history = Array.isArray(inspectionDoc.assignmentHistory) ? inspectionDoc.assignmentHistory : [];
  const lastEntry = history.length > 0 ? history[history.length - 1] : null;
  if (lastEntry?.assignedBy) return lastEntry.assignedBy.toString();
  return null;
}

async function upsertInProgressTicketForInspection({ inspection, employeeUserId }) {
  const assignedAdminId = resolveAssignedAdminId(inspection);
  if (!assignedAdminId || assignedAdminId === employeeUserId.toString()) return;
  if (!inspection.progressImageUrl) return;

  const title = `Room Inspection In Progress - ${inspection.roomLabel}`;
  const noteText = String(inspection.notes || '').trim();
  const description = noteText
    ? `Room: ${inspection.roomLabel}\nDate: ${inspection.inspectionDate}\nNotes: ${noteText}`
    : `Room: ${inspection.roomLabel}\nDate: ${inspection.inspectionDate}\nInspection marked in progress by employee.`;

  const openTicket = await Ticket.findOne({
    roomInspection: inspection._id,
    createdBy: employeeUserId,
    assignedTo: assignedAdminId,
    status: { $in: ['pending', 'in_progress'] },
  });

  if (openTicket) {
    openTicket.title = title;
    openTicket.description = description;
    openTicket.imageUrl = inspection.progressImageUrl;
    openTicket.priority = 'medium';
    await openTicket.save();
    return;
  }

  await Ticket.create({
    title,
    description,
    status: 'pending',
    priority: 'medium',
    imageUrl: inspection.progressImageUrl,
    assignedTo: assignedAdminId,
    createdBy: employeeUserId,
    roomInspection: inspection._id,
    assignmentHistory: [
      {
        assignedBy: employeeUserId,
        assignedTo: assignedAdminId,
        department: inspection.department || null,
        assignedAt: new Date(),
      },
    ],
  });
}

/**
 * Creates room inspection rows for one category and date only (when none exist yet).
 * Used only from PATCH /assign-category so listing a category never inserts DB rows.
 */
async function ensureCategorySeed(inspectionDate, categoryKey, user) {
  const key = String(categoryKey || '').trim();
  if (!key) return;

  const existing = await RoomInspection.countDocuments({ inspectionDate, categoryKey: key });
  if (existing > 0) return;

  const category = ROOM_CATEGORIES.find((item) => item.key === key);
  if (!category) return;

  const department = user.department || 'House Keeping';
  const checklistTemplate = getChecklistForCategory(category.name).map((label) => ({ label, isChecked: false }));
  const seedDocs = Array.from({ length: category.totalRooms }, (_, idx) => {
    const roomNumber = idx + 1;
    return {
      inspectionDate,
      categoryKey: category.key,
      categoryName: category.name,
      roomNumber,
      roomLabel: buildRoomLabel(category.name, roomNumber),
      department,
      checklist: checklistTemplate,
      createdBy: user._id,
    };
  });

  await RoomInspection.insertMany(seedDocs, { ordered: false });
}

async function getAssignableUsersForCategory(requester) {
  if (requester.role !== 'admin') return [];
  if (requester.isMainAdmin) {
    return User.find({ role: 'employee' })
      .select('_id name role department')
      .sort({ name: 1 });
  }
  if (!requester.department) return [];

  // First try indexed query by exact/case-insensitive match.
  const department = String(requester.department).trim();
  const directMatches = await User.find({
    role: 'employee',
    department: { $regex: `^${department}$`, $options: 'i' },
  })
    .select('_id name role department')
    .sort({ name: 1 });
  if (directMatches.length > 0) return directMatches;

  // Fallback: normalize repeated spaces and compare in memory.
  const allEmployees = await User.find({ role: 'employee' })
    .select('_id name role department')
    .sort({ name: 1 });
  const requesterDept = normalizeDepartmentLoose(requester.department);
  return allEmployees.filter((item) => normalizeDepartmentLoose(item.department) === requesterDept);
}

router.get('/dashboard', async (req, res) => {
  try {
    const inspectionDate = toDateKey(req.query.date || req.query.filterDate);

    const filter = { inspectionDate };
    if (req.user.role === 'employee') {
      filter.assignedTo = req.user._id;
    }

    const inspections = await RoomInspection.find(filter)
      .populate('assignedTo', 'name role department')
      .sort({ categoryName: 1, roomNumber: 1 });

    const categories = ROOM_CATEGORIES.map((category) => {
      const records = inspections.filter((item) => item.categoryKey === category.key);
      const completed = records.filter((item) => item.status === 'completed').length;
      const assignedTo = records.find((item) => item.assignedTo)?.assignedTo || null;
      return {
        categoryKey: category.key,
        categoryName: category.name,
        totalRooms: category.totalRooms,
        completedRooms: completed,
        progress: `${completed}/${category.totalRooms}`,
        assignedTo,
      };
    });

    const summary = {
      total: inspections.length,
      completed: inspections.filter((item) => item.status === 'completed').length,
      inProgress: inspections.filter((item) => item.status === 'in_progress').length,
      pending: inspections.filter((item) => item.status === 'pending').length,
    };

    return res.json({ inspectionDate, categories, summary });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch room inspection dashboard' });
  }
});

router.get('/calendar', async (req, res) => {
  try {
    const month = monthKeyFromDate(req.query.month || toDateKey());
    const colorFilter = String(req.query.color || '').trim().toLowerCase();
    const dateFilter = req.query.date ? toDateKey(req.query.date) : '';
    const filter = { inspectionDate: { $regex: `^${month}` } };
    if (dateFilter) {
      filter.inspectionDate = dateFilter;
    }
    if (req.user.role === 'employee') {
      filter.assignedTo = req.user._id;
    }

    const docs = await RoomInspection.find(filter).select('inspectionDate status');
    const dayMap = new Map();
    docs.forEach((doc) => {
      const prev = dayMap.get(doc.inspectionDate) || { total: 0, completed: 0 };
      prev.total += 1;
      if (doc.status === 'completed') prev.completed += 1;
      dayMap.set(doc.inspectionDate, prev);
    });

    const days = Array.from(dayMap.entries()).map(([date, data]) => {
      let color = 'red';
      if (data.completed === data.total && data.total > 0) color = 'green';
      else if (data.completed > 0) color = 'yellow';
      return { date, total: data.total, completed: data.completed, color };
    });

    const allowedColors = new Set(['green', 'yellow', 'red']);
    const filteredDays = (allowedColors.has(colorFilter)
      ? days.filter((day) => day.color === colorFilter)
      : days
    ).sort((a, b) => a.date.localeCompare(b.date));

    return res.json({ month, days: filteredDays });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch calendar data' });
  }
});

router.get('/', async (req, res) => {
  try {
    const inspectionDate = toDateKey(req.query.date);
    const categoryKey = String(req.query.category || '').trim();
    if (!categoryKey) {
      return res.status(400).json({ message: 'category is required' });
    }

    // Do not seed on read: clients (e.g. web dashboard with another category selected) would
    // create rows for that category. Inspection rows are created only in PATCH /assign-category.
    const filter = { inspectionDate, categoryKey };
    if (req.user.role === 'employee') {
      filter.assignedTo = req.user._id;
    }

    const inspections = await RoomInspection.find(filter)
      .populate('assignedTo', 'name role department')
      .populate('assignedBy', 'name role department')
      .populate('assignmentHistory.assignedBy', 'name role department')
      .sort({ roomNumber: 1 });
    return res.json({ inspectionDate, count: inspections.length, inspections });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch room inspections' });
  }
});

router.get('/assignable-users', async (req, res) => {
  try {
    const users = await getAssignableUsersForCategory(req.user);
    return res.json({ count: users.length, users });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch assignable users' });
  }
});

router.patch(
  '/assign-category',
  [
    body('inspectionDate').notEmpty().withMessage('inspectionDate is required'),
    body('categoryKey').notEmpty().withMessage('categoryKey is required'),
    body('assignedTo').notEmpty().withMessage('assignedTo is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Only admin can assign category staff' });
      }

      const inspectionDate = toDateKey(req.body.inspectionDate);
      const categoryKey = String(req.body.categoryKey).trim();
      const assignedTo = String(req.body.assignedTo).trim();
      await ensureCategorySeed(inspectionDate, categoryKey, req.user);

      const assignee = await User.findById(assignedTo).select('_id name role department pushToken');
      if (!assignee || assignee.role !== 'employee') {
        return res.status(400).json({ message: 'Assignee must be an employee' });
      }

      if (!req.user.isMainAdmin && normalizeDepartment(assignee.department) !== normalizeDepartment(req.user.department)) {
        return res.status(400).json({ message: 'Department admin can assign only their department employees' });
      }

      const docs = await RoomInspection.find({ inspectionDate, categoryKey });
      if (docs.length === 0) {
        return res.status(404).json({ message: 'No rooms found for this category/date' });
      }

      await RoomInspection.updateMany(
        { inspectionDate, categoryKey },
        {
          $set: {
            assignedTo: assignee._id,
            assignedBy: req.user._id,
            department: assignee.department || req.user.department || 'House Keeping',
          },
          $push: {
            assignmentHistory: {
              assignedBy: req.user._id,
              assignedTo: assignee._id,
              assignedAt: new Date(),
            },
          },
        }
      );

      const selectedCategory = ROOM_CATEGORIES.find((item) => item.key === categoryKey);
      const pushResult = await sendExpoPushNotification(
        assignee.pushToken,
        'Room Inspection Assigned',
        `${selectedCategory?.name || 'Category'} assigned for ${inspectionDate}`,
        {
          type: 'room_inspection_assigned',
          inspectionDate,
          categoryKey,
        }
      );
      if (!pushResult?.ok) {
        console.error('Room inspection assignment push not delivered', {
          assigneeId: assignee._id?.toString(),
          reason: pushResult?.reason,
        });
      }

      return res.json({
        message: 'Category assigned successfully',
        push: pushResult?.ok
          ? { ok: true }
          : { ok: false, reason: pushResult?.reason || 'unknown_push_error' },
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to assign category' });
    }
  }
);

router.get('/:id', async (req, res) => {
  try {
    const inspection = await RoomInspection.findById(req.params.id)
      .populate('assignedTo', 'name role department')
      .populate('assignedBy', 'name role department')
      .populate('assignmentHistory.assignedBy', 'name role department')
      .populate('assignmentHistory.assignedTo', 'name role department');
    if (!inspection) {
      return res.status(404).json({ message: 'Inspection not found' });
    }

    if (req.user.role === 'employee' && inspection.assignedTo?._id?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can access only your assigned inspection' });
    }
    if (
      req.user.role === 'admin' &&
      !req.user.isMainAdmin &&
      normalizeDepartment(inspection.department) !== normalizeDepartment(req.user.department)
    ) {
      return res.status(403).json({ message: 'You can access only your department inspection' });
    }

    return res.json(inspection);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch inspection detail' });
  }
});

router.patch('/:id/checklist', upload.single('image'), async (req, res) => {
  try {
    const checklistRaw = req.body?.checklist;
    const notesRaw = req.body?.notes;
    const inspection = await RoomInspection.findById(req.params.id);
    if (!inspection) {
      return res.status(404).json({ message: 'Inspection not found' });
    }

    const isMainAdmin = req.user.role === 'admin' && req.user.isMainAdmin;
    const isAssignee = inspection.assignedTo && inspection.assignedTo.toString() === req.user._id.toString();
    if (!isMainAdmin && !isAssignee) {
      return res.status(403).json({ message: 'Only assigned staff or main admin can update checklist' });
    }

    let checklist = checklistRaw;
    if (typeof checklistRaw === 'string') {
      try {
        checklist = JSON.parse(checklistRaw);
      } catch (e) {
        checklist = undefined;
      }
    }

    if (Array.isArray(checklist)) {
      inspection.checklist = checklist;
    }
    if (notesRaw !== undefined) {
      inspection.notes = String(notesRaw);
    }
    if (req.file) {
      const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      const uploadResult = await cloudinary.uploader.upload(base64Image, {
        folder: 'room-inspections/progress',
      });
      inspection.progressImageUrl = uploadResult.secure_url;
    }
    if (inspection.status === 'pending') {
      inspection.status = 'in_progress';
      inspection.startedAt = inspection.startedAt || new Date();
    }

    const updated = await inspection.save();
    if (req.user.role === 'employee' && isAssignee && updated.status === 'in_progress') {
      await upsertInProgressTicketForInspection({
        inspection: updated,
        employeeUserId: req.user._id,
      });
    }
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save checklist' });
  }
});

router.patch('/:id/complete', async (req, res) => {
  try {
    const inspection = await RoomInspection.findById(req.params.id);
    if (!inspection) {
      return res.status(404).json({ message: 'Inspection not found' });
    }

    const isMainAdmin = req.user.role === 'admin' && req.user.isMainAdmin;
    const isAssignee = inspection.assignedTo && inspection.assignedTo.toString() === req.user._id.toString();
    if (!isMainAdmin && !isAssignee) {
      return res.status(403).json({ message: 'Only assigned staff or main admin can complete' });
    }

    const hasUnchecked = inspection.checklist.some((item) => !item.isChecked);
    if (hasUnchecked) {
      return res.status(400).json({ message: 'Please complete all checklist items before finishing room' });
    }

    inspection.status = 'completed';
    inspection.completedAt = new Date();
    inspection.completedBy = req.user._id;
    inspection.startedAt = inspection.startedAt || inspection.completedAt;
    const updated = await inspection.save();
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to complete room inspection' });
  }
});

module.exports = router;
