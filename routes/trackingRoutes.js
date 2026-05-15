const express = require('express');
const { body, validationResult } = require('express-validator');

const Attendance = require('../models/Attendance');
const LocationPing = require('../models/LocationPing');
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

function isOnShift(attendance) {
  if (!attendance?.checkIn) return false;
  if (!attendance.checkOut) return true;
  const inAt = new Date(attendance.checkIn.capturedAt).getTime();
  const outAt = new Date(attendance.checkOut.capturedAt).getTime();
  return outAt <= inAt;
}

function adminCanSeeUser(admin, targetUser) {
  if (!targetUser) return false;
  if (admin.isMainAdmin) return true;
  return targetUser.department === admin.department;
}

router.post(
  '/ping',
  [
    body('latitude').optional().isFloat({ min: -90, max: 90 }),
    body('longitude').optional().isFloat({ min: -180, max: 180 }),
    body('pings').optional().isArray({ min: 1 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const dateKey = todayKey();
      const attendance = await Attendance.findOne({ user: req.user._id, dateKey });
      if (!isOnShift(attendance)) {
        return res.status(400).json({ message: 'Location tracking is only allowed while checked in' });
      }

      const rawPings = Array.isArray(req.body.pings)
        ? req.body.pings
        : [
            {
              latitude: req.body.latitude,
              longitude: req.body.longitude,
              accuracy: req.body.accuracy,
              capturedAt: req.body.capturedAt,
            },
          ];

      const docs = rawPings
        .filter((item) => item && item.latitude != null && item.longitude != null)
        .map((item) => ({
          user: req.user._id,
          dateKey,
          latitude: Number(item.latitude),
          longitude: Number(item.longitude),
          accuracy: item.accuracy != null ? Number(item.accuracy) : null,
          capturedAt: item.capturedAt ? new Date(item.capturedAt) : new Date(),
        }));

      if (docs.length === 0) {
        return res.status(400).json({ message: 'At least one valid location ping is required' });
      }

      const inserted = await LocationPing.insertMany(docs, { ordered: false });
      return res.status(201).json({
        message: 'Location recorded',
        count: inserted.length,
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to record location' });
    }
  }
);

router.get('/live', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can view live tracking' });
    }

    const dateKey = req.query.date ? String(req.query.date).slice(0, 10) : todayKey();

    const attendanceDocs = await Attendance.find({ dateKey, checkIn: { $ne: null } })
      .populate('user', 'name phone role department')
      .lean();

    const includeAll = req.query.all === 'true' || req.query.includeCheckedOut === 'true';
    const employeeAttendance = attendanceDocs.filter((item) => item.user?.role === 'employee');
    const visibleAttendance = employeeAttendance.filter((item) => adminCanSeeUser(req.user, item.user));

    const scoped = includeAll
      ? visibleAttendance
      : visibleAttendance.filter((item) => isOnShift(item));

    const userIds = scoped.map((item) => item.user._id);
    if (userIds.length === 0) {
      return res.json({ dateKey, employees: [], summary: { total: 0, onShift: 0, withLocation: 0 } });
    }

    const latestPings = await LocationPing.aggregate([
      { $match: { dateKey, user: { $in: userIds } } },
      { $sort: { capturedAt: -1 } },
      {
        $group: {
          _id: '$user',
          latitude: { $first: '$latitude' },
          longitude: { $first: '$longitude' },
          accuracy: { $first: '$accuracy' },
          capturedAt: { $first: '$capturedAt' },
        },
      },
    ]);

    const pingByUser = new Map(latestPings.map((item) => [String(item._id), item]));

    const employees = scoped.map((item) => {
      const ping = pingByUser.get(String(item.user._id));
      const onShift = isOnShift(item);
      const display =
        ping != null
          ? {
              latitude: ping.latitude,
              longitude: ping.longitude,
              accuracy: ping.accuracy,
              capturedAt: ping.capturedAt,
              capturedAtLabel: toDateTimeLabel(ping.capturedAt),
              source: 'gps',
            }
          : item.checkIn
          ? {
              latitude: item.checkIn.latitude,
              longitude: item.checkIn.longitude,
              accuracy: null,
              capturedAt: item.checkIn.capturedAt,
              capturedAtLabel: toDateTimeLabel(item.checkIn.capturedAt),
              source: 'check_in',
            }
          : null;

      return {
        user: {
          _id: item.user._id,
          name: item.user.name,
          phone: item.user.phone,
          department: item.user.department,
        },
        onShift,
        status: onShift ? 'on_shift' : 'checked_out',
        checkIn: item.checkIn
          ? {
              latitude: item.checkIn.latitude,
              longitude: item.checkIn.longitude,
              capturedAt: item.checkIn.capturedAt,
              capturedAtLabel: toDateTimeLabel(item.checkIn.capturedAt),
            }
          : null,
        checkOut: item.checkOut
          ? {
              latitude: item.checkOut.latitude,
              longitude: item.checkOut.longitude,
              capturedAt: item.checkOut.capturedAt,
              capturedAtLabel: toDateTimeLabel(item.checkOut.capturedAt),
            }
          : null,
        lastPing: ping
          ? {
              latitude: ping.latitude,
              longitude: ping.longitude,
              accuracy: ping.accuracy,
              capturedAt: ping.capturedAt,
              capturedAtLabel: toDateTimeLabel(ping.capturedAt),
            }
          : null,
        displayLocation: display,
      };
    });

    const summary = {
      total: employees.length,
      onShift: employees.filter((item) => item.onShift).length,
      withLocation: employees.filter((item) => item.displayLocation).length,
    };

    return res.json({ dateKey, employees, summary });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch live tracking' });
  }
});

router.get('/trail', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can view location trail' });
    }

    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const User = require('../models/User');
    const targetUser = await User.findById(userId).select('name phone department role');
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (!adminCanSeeUser(req.user, targetUser)) {
      return res.status(403).json({ message: 'Not allowed to view this employee trail' });
    }

    const dateKey = req.query.date ? String(req.query.date).slice(0, 10) : todayKey();
    const pings = await LocationPing.find({ user: userId, dateKey }).sort({ capturedAt: 1 }).lean();

    return res.json({
      dateKey,
      user: {
        _id: targetUser._id,
        name: targetUser.name,
        phone: targetUser.phone,
        department: targetUser.department,
      },
      pings: pings.map((item) => ({
        latitude: item.latitude,
        longitude: item.longitude,
        accuracy: item.accuracy,
        capturedAt: item.capturedAt,
        capturedAtLabel: toDateTimeLabel(item.capturedAt),
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch location trail' });
  }
});

module.exports = router;
