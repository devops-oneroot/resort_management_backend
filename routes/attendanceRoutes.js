const express = require('express');
const { body, validationResult } = require('express-validator');

const Attendance = require('../models/Attendance');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(protect);

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateTimeLabel(value) {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

router.get('/today', async (req, res) => {
  try {
    const dateKey = todayKey();
    const record = await Attendance.findOne({ user: req.user._id, dateKey });
    return res.json({
      dateKey,
      checkedIn: Boolean(record?.checkIn),
      checkedOut: Boolean(record?.checkOut),
      checkIn: record?.checkIn || null,
      checkOut: record?.checkOut || null,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch attendance status' });
  }
});

router.post(
  '/check-in',
  [
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    try {
      const dateKey = todayKey();
      const point = {
        latitude: Number(req.body.latitude),
        longitude: Number(req.body.longitude),
        capturedAt: new Date(),
      };

      const record = await Attendance.findOneAndUpdate(
        { user: req.user._id, dateKey },
        { $set: { checkIn: point } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      return res.status(201).json({
        message: 'Checked in successfully',
        attendance: record,
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to check in' });
    }
  }
);

router.post(
  '/check-out',
  [
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    try {
      const dateKey = todayKey();
      const point = {
        latitude: Number(req.body.latitude),
        longitude: Number(req.body.longitude),
        capturedAt: new Date(),
      };

      const record = await Attendance.findOneAndUpdate(
        { user: req.user._id, dateKey },
        { $set: { checkOut: point } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      return res.json({
        message: 'Checked out successfully',
        attendance: record,
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to check out' });
    }
  }
);

router.get('/', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can view attendance records' });
    }

    const filter = {};
    if (req.query.date) {
      filter.dateKey = String(req.query.date).slice(0, 10);
    }

    const docs = await Attendance.find(filter)
      .populate('user', 'name phone role department')
      .sort({ dateKey: -1, createdAt: -1 });

    const rows = docs
      .filter((item) => {
        if (req.user.isMainAdmin) return true;
        return item.user && item.user.department === req.user.department;
      })
      .map((item) => ({
        _id: item._id,
        dateKey: item.dateKey,
        user: item.user
          ? {
              _id: item.user._id,
              name: item.user.name,
              phone: item.user.phone,
              department: item.user.department,
            }
          : null,
        checkIn: item.checkIn
          ? {
              ...item.checkIn.toObject(),
              capturedAtLabel: toDateTimeLabel(item.checkIn.capturedAt),
            }
          : null,
        checkOut: item.checkOut
          ? {
              ...item.checkOut.toObject(),
              capturedAtLabel: toDateTimeLabel(item.checkOut.capturedAt),
            }
          : null,
      }));

    return res.json({ count: rows.length, attendance: rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch attendance records' });
  }
});

module.exports = router;
