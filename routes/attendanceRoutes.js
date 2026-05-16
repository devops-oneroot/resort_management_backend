const express = require('express');
const { body, validationResult } = require('express-validator');

const Attendance = require('../models/Attendance');
const LocationPing = require('../models/LocationPing');
const { protect } = require('../middleware/authMiddleware');
const { todayKey, toDateKeyInput, toDateTimeLabel } = require('../utils/dateKey');

const router = express.Router();
router.use(protect);

function isOnShift(record) {
  if (!record?.checkIn) return false;
  if (!record.checkOut) return true;
  const inAt = new Date(record.checkIn.capturedAt).getTime();
  const outAt = new Date(record.checkOut.capturedAt).getTime();
  return outAt <= inAt;
}

function normalizeDepartment(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

router.get('/today', async (req, res) => {
  try {
    const dateKey = todayKey();
    const record = await Attendance.findOne({ user: req.user._id, dateKey });
    const onShift = isOnShift(record);
    return res.json({
      dateKey,
      serverTodayKey: dateKey,
      checkedIn: Boolean(record?.checkIn),
      checkedOut: Boolean(record?.checkOut) && !onShift,
      onShift,
      checkIn: record?.checkIn
        ? { ...record.checkIn.toObject(), capturedAtLabel: toDateTimeLabel(record.checkIn.capturedAt) }
        : null,
      checkOut: record?.checkOut
        ? { ...record.checkOut.toObject(), capturedAtLabel: toDateTimeLabel(record.checkOut.capturedAt) }
        : null,
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
        { $set: { checkIn: point }, $unset: { checkOut: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      await LocationPing.create({
        user: req.user._id,
        dateKey,
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: null,
        capturedAt: point.capturedAt,
      });

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

    const requestedDateKey = toDateKeyInput(req.query.date);
    const filter = { dateKey: requestedDateKey };

    const docs = await Attendance.find(filter)
      .populate('user', 'name phone role department')
      .sort({ dateKey: -1, createdAt: -1 });

    const adminDepartment = normalizeDepartment(req.user.department);

    const rows = docs
      .filter((item) => {
        if (!item.user) return false;
        if (req.user.isMainAdmin) return true;
        return normalizeDepartment(item.user.department) === adminDepartment;
      })
      .filter((item) => item.user.role === 'employee')
      .filter((item) => Boolean(item.checkIn))
      .map((item) => ({
        _id: item._id,
        dateKey: item.dateKey,
        user: item.user
          ? {
              _id: item.user._id,
              name: item.user.name,
              phone: item.user.phone,
              role: item.user.role,
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

    return res.json({
      count: rows.length,
      dateKey: requestedDateKey,
      serverTodayKey: todayKey(),
      attendance: rows,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch attendance records' });
  }
});

module.exports = router;
