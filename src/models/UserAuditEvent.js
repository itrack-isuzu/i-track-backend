import mongoose from 'mongoose';

import { USER_ROLES } from '../constants/enums.js';
import { baseSchemaOptions } from '../utils/schemaOptions.js';

const userAuditEventSchema = new mongoose.Schema(
  {
    deletedUserId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    role: {
      type: String,
      enum: USER_ROLES,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: ['deleted'],
      default: 'deleted',
      required: true,
      index: true,
    },
  },
  baseSchemaOptions
);

userAuditEventSchema.index({
  createdAt: -1,
});

export const UserAuditEvent =
  mongoose.models.UserAuditEvent ||
  mongoose.model('UserAuditEvent', userAuditEventSchema);
