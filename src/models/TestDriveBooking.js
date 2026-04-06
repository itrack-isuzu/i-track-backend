import mongoose from 'mongoose';

import { TEST_DRIVE_STATUSES } from '../constants/enums.js';
import { baseSchemaOptions } from '../utils/schemaOptions.js';

const testDriveBookingSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
      index: true,
    },
    requestedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    customerPhone: {
      type: String,
      required: true,
      trim: true,
    },
    scheduledDate: {
      type: String,
      required: true,
      trim: true,
    },
    scheduledTime: {
      type: String,
      required: true,
      trim: true,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: TEST_DRIVE_STATUSES,
      default: 'pending',
      index: true,
    },
  },
  baseSchemaOptions
);

export const TestDriveBooking =
  mongoose.models.TestDriveBooking ||
  mongoose.model('TestDriveBooking', testDriveBookingSchema);
