import mongoose from 'mongoose';

import { NOTIFICATION_TYPES } from '../constants/enums.js';
import { baseSchemaOptions } from '../utils/schemaOptions.js';

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      default: 'system',
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    pushDeliveries: {
      type: [new mongoose.Schema({
        token: String, ticketId: String,
        status: { type: String, enum: ['queued', 'accepted', 'error', 'unknown'], required: true },
        error: String, checkedAt: Date, nextCheckAt: Date, attempts: { type: Number, default: 0 },
      }, { _id: false })],
      default: [],
      select: false,
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  baseSchemaOptions
);

notificationSchema.index({
  userId: 1,
  createdAt: -1,
});

notificationSchema.index({
  userId: 1,
  read: 1,
  createdAt: -1,
});

export const Notification =
  mongoose.models.Notification ||
  mongoose.model('Notification', notificationSchema);
