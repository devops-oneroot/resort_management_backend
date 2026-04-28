const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const cloudinary = require('../config/cloudinary');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

router.post(
  '/register',
  upload.single('profileImage'),
  async (req, res) => {
    try {
      let parsedPayload = {};
      if (req.body?.payload) {
        try {
          parsedPayload = JSON.parse(String(req.body.payload));
        } catch (e) {
          parsedPayload = {};
        }
      }
      const getField = (key) => {
        const value = req.body?.[key] ?? parsedPayload?.[key];
        if (Array.isArray(value)) return String(value[0] ?? '').trim();
        if (value === undefined || value === null) return '';
        return String(value).trim();
      };

      const name = getField('name');
      const phone = getField('phone');
      const password = getField('password');
      const role = getField('role').toLowerCase();
      const department = getField('department');
      const isMainAdminRaw = req.body?.isMainAdmin ?? parsedPayload?.isMainAdmin;
      const isMainAdmin = isMainAdminRaw === true || isMainAdminRaw === 'true';

      if (!name) {
        return res.status(400).json({ message: 'Name is required' });
      }
      if (!phone) {
        return res.status(400).json({ message: 'Phone is required' });
      }
      if (!password || password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
      }
      if (!['admin', 'employee'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role' });
      }

      const existingUser = await User.findOne({ phone });
      if (existingUser) {
        return res.status(400).json({ message: 'User already exists with this phone number' });
      }

      if (role === 'employee' && !department) {
        return res.status(400).json({ message: 'Department is required for employee role' });
      }
      if (role === 'admin' && !isMainAdmin && !department) {
        return res.status(400).json({ message: 'Department is required for department admin' });
      }
      if (role === 'employee' && !req.file) {
        return res.status(400).json({ message: 'Profile image is required for employee signup' });
      }

      let profileImageUrl = null;
      if (req.file) {
        const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        const uploadResult = await cloudinary.uploader.upload(base64Image, {
          folder: 'users/profile',
        });
        profileImageUrl = uploadResult.secure_url;
      }

      const user = await User.create({
        name,
        phone,
        password,
        role,
        isMainAdmin: role === 'admin' ? Boolean(isMainAdmin) : false,
        department: role === 'employee' ? department : isMainAdmin ? 'ALL' : department || null,
        profileImageUrl,
      });
      const token = generateToken(user._id);

      return res.status(201).json({
        token,
        user: {
          id: user._id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          isMainAdmin: user.isMainAdmin,
          department: user.department,
          profileImageUrl: user.profileImageUrl,
        },
      });
    } catch (error) {
      console.error('Register error:', error);
      return res.status(500).json({ message: 'Failed to register user' });
    }
  }
);

router.post(
  '/login',
  [
    body('phone').notEmpty().withMessage('Phone is required'),
    body('password').notEmpty().withMessage('Password is required'),
    body('role').isIn(['admin', 'employee']).withMessage('Invalid role'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const firstError = errors.array()[0]?.msg || 'Validation failed';
      return res.status(400).json({ message: firstError, errors: errors.array() });
    }

    try {
      const { phone, role, password } = req.body;
      const user = await User.findOne({ phone, role }).select('+password');

      if (!user) {
        return res.status(401).json({ message: 'User not found. Please sign up first.' });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid password' });
      }

      const token = generateToken(user._id);
      return res.json({
        token,
        user: {
          id: user._id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          isMainAdmin: user.isMainAdmin,
          department: user.department,
          profileImageUrl: user.profileImageUrl,
        },
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to login' });
    }
  }
);

router.get('/me', protect, async (req, res) => {
  res.json({ user: req.user });
});

router.patch(
  '/push-token',
  protect,
  [body('pushToken').isString().notEmpty().withMessage('pushToken is required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const firstError = errors.array()[0]?.msg || 'Validation failed';
      return res.status(400).json({ message: firstError, errors: errors.array() });
    }

    try {
      req.user.pushToken = String(req.body.pushToken).trim();
      await req.user.save();
      return res.json({ message: 'Push token saved' });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to save push token' });
    }
  }
);

router.get('/employees', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can view employees' });
    }

    const filter = { role: 'employee' };
    if (!req.user.isMainAdmin) {
      filter.department = req.user.department;
    } else if (req.query.department) {
      filter.department = req.query.department;
    }

    const employees = await User.find(filter)
      .select('_id name phone role department')
      .sort({ name: 1 });

    return res.json({ count: employees.length, employees });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch employees' });
  }
});

router.get('/department-employees', protect, async (req, res) => {
  try {
    if (req.user.role !== 'employee') {
      return res.status(403).json({ message: 'Only employee can view department users' });
    }
    if (!req.user.department) {
      return res.json({ count: 0, employees: [] });
    }

    const department = String(req.user.department).trim();
    const employees = await User.find({
      role: 'employee',
      department: { $regex: `^${department}$`, $options: 'i' },
    })
      .select('_id name phone role department')
      .sort({ name: 1 });

    return res.json({ count: employees.length, employees });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch department employees' });
  }
});

module.exports = router;
