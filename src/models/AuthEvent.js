import mongoose from 'mongoose';

import { baseSchemaOptions } from '../utils/schemaOptions.js';

const authEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
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
      default: null,
      trim: true,
    },
    eventType: {
      type: String,
      enum: ['login', 'logout'],
      required: true,
      index: true,
    },
  },
  baseSchemaOptions
);

authEventSchema.index({
  createdAt: -1,
});

export const AuthEvent =
  mongoose.models.AuthEvent || mongoose.model('AuthEvent', authEventSchema);
