import mongoose from 'mongoose';

import { ALLOCATION_STATUSES } from '../constants/enums.js';
import { baseSchemaOptions } from '../utils/schemaOptions.js';

const routeStopSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
  },
  {
    _id: false,
  }
);

const driverAllocationSchema = new mongoose.Schema(
  {
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
      index: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ALLOCATION_STATUSES,
      default: 'pending',
      index: true,
    },
    pickupLocation: {
      type: routeStopSchema,
      required: true,
    },
    destinationLocation: {
      type: routeStopSchema,
      required: true,
    },
    estimatedDuration: {
      type: Number,
      default: 0,
      min: 0,
    },
    actualDuration: {
      type: Number,
      default: null,
      min: 0,
    },
    startTime: {
      type: Date,
      default: null,
    },
    endTime: {
      type: Date,
      default: null,
    },
    routeProgress: {
      type: Number,
      default: null,
      min: 0,
      max: 1,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
  },
  baseSchemaOptions
);

driverAllocationSchema.index({
  vehicleId: 1,
  status: 1,
  createdAt: -1,
});

driverAllocationSchema.index({
  driverId: 1,
  status: 1,
  createdAt: -1,
});

export const DriverAllocation =
  mongoose.models.DriverAllocation ||
  mongoose.model('DriverAllocation', driverAllocationSchema);
