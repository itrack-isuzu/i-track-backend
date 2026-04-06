import mongoose from 'mongoose';

import {
  PUSH_TOKEN_PLATFORMS,
  USER_ROLES,
} from '../constants/enums.js';
import { baseSchemaOptions } from '../utils/schemaOptions.js';

const passwordResetSchema = new mongoose.Schema(
  {
    otpHash: {
      type: String,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    lastSentAt: {
      type: Date,
      default: null,
    },
    attempts: {
      type: Number,
      default: 0,
    },
  },
  {
    _id: false,
    id: false,
  }
);

const pushTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      trim: true,
    },
    platform: {
      type: String,
      enum: PUSH_TOKEN_PLATFORMS,
      default: 'unknown',
    },
    deviceName: {
      type: String,
      default: '',
      trim: true,
    },
    projectId: {
      type: String,
      default: null,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastRegisteredAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    _id: false,
    id: false,
  }
);

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    bio: {
      type: String,
      default: '',
      trim: true,
    },
    role: {
      type: String,
      required: true,
      enum: USER_ROLES,
      index: true,
    },
    avatarUrl: {
      type: String,
      default: null,
      trim: true,
    },
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    passwordReset: {
      type: passwordResetSchema,
      select: false,
      default: undefined,
    },
    pushTokens: {
      type: [pushTokenSchema],
      default: [],
    },
  },
  baseSchemaOptions
);

userSchema.virtual('name').get(function getName() {
  return `${this.firstName} ${this.lastName}`.trim();
});

userSchema.pre('validate', function normalizeUser(next) {
  if (this.email) {
    this.email = this.email.trim().toLowerCase();
  }

  next();
});

export const User = mongoose.models.User || mongoose.model('User', userSchema);
