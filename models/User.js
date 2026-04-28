const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ['admin', 'employee'],
      default: 'employee',
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },
    isMainAdmin: {
      type: Boolean,
      default: false,
    },
    department: {
      type: String,
      default: null,
      trim: true,
    },
    profileImageUrl: {
      type: String,
      default: null,
      trim: true,
    },
    pushToken: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { timestamps: true }
);

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

module.exports = mongoose.model('User', userSchema);
