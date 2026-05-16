const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const DailyTask = require('../models/DailyTask');
const cloudinary = require('../config/cloudinary');
const { protect } = require('../middleware/authMiddleware');
const dailyTaskCompleteOnePost = require('../handlers/dailyTaskCompleteOne');
const { completeDailyTaskById } = dailyTaskCompleteOnePost;
const { toDateKeyInput } = require('../utils/dateKey');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(protect);

/** Same as app-level POST; lives on router so /api/daily-tasks/complete-one always exists when this file is mounted. */
router.post('/complete-one', dailyTaskCompleteOnePost);

function normalizeDepartment(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

router.post(
  '/start',
  upload.any(),
  [
    body('taskTitle').notEmpty().withMessage('Task title is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const files = Array.isArray(req.files) ? req.files : [];
      const imageFile = files.find((item) => item.fieldname === 'startImage') || files.find((item) => item.fieldname === 'image') || null;
      if (!imageFile) {
        return res.status(400).json({ message: 'Start image is mandatory' });
      }
      if (req.user.role !== 'employee') {
        return res.status(403).json({ message: 'Only employee can start daily task' });
      }
      if (!req.user.department) {
        return res.status(400).json({ message: 'Employee department is missing' });
      }

      const base64Image = `data:${imageFile.mimetype};base64,${imageFile.buffer.toString('base64')}`;
      const uploadResult = await cloudinary.uploader.upload(base64Image, {
        folder: 'daily-tasks/start',
      });

      const now = new Date();
      const dateKey = toDateKeyInput(now);
      const task = await DailyTask.create({
        taskTitle: String(req.body.taskTitle || '').trim(),
        employee: req.user._id,
        department: req.user.department,
        dateKey,
        status: 'started',
        startTime: now,
        startImageUrl: uploadResult.secure_url,
      });

      return res.status(201).json(task);
    } catch (error) {
      return res.status(500).json({ message: 'Failed to start daily task' });
    }
  }
);

/** No multer: JSON-only PATCH (single start image is enough). */
router.patch('/:id/complete', (req, res) => completeDailyTaskById(req, res, req.params.id));

/** Legacy path — same behavior, no file required. */
router.patch('/:id/end', (req, res) => completeDailyTaskById(req, res, req.params.id));

router.get('/my-today', async (req, res) => {
  try {
    const dateKey = toDateKeyInput(req.query.date);
    if (!dateKey) {
      return res.status(400).json({ message: 'Invalid date' });
    }

    const tasks = await DailyTask.find({
      employee: req.user._id,
      dateKey,
    })
      .populate('employee', 'name phone department role')
      .sort({ startTime: -1 });

    return res.json({ count: tasks.length, tasks });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch daily tasks' });
  }
});

router.get('/admin', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can view all daily tasks' });
    }

    const dateKey = toDateKeyInput(req.query.date);
    if (!dateKey) {
      return res.status(400).json({ message: 'Invalid date' });
    }

    const filter = { dateKey };
    const requestedDepartment = String(req.query.department || '').trim();

    if (req.user.isMainAdmin) {
      if (requestedDepartment) {
        filter.department = requestedDepartment;
      }
    } else {
      filter.department = req.user.department;
    }

    const tasks = await DailyTask.find(filter)
      .populate('employee', 'name phone department role')
      .sort({ startTime: -1 });

    return res.json({ count: tasks.length, tasks });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch admin daily tasks' });
  }
});

module.exports = router;
