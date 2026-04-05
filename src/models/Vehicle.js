import mongoose from 'mongoose';

import { VEHICLE_STATUSES } from '../constants/enums.js';
import { baseSchemaOptions } from '../utils/schemaOptions.js';

const locationSchema = new mongoose.Schema(
  {
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

const vehicleSchema = new mongoose.Schema(
  {
    unitName: {
      type: String,
      required: true,
      trim: true,
    },
    variation: {
      type: String,
      required: true,
      trim: true,
    },
    conductionNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    bodyColor: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: VEHICLE_STATUSES,
      default: 'available',
      index: true,
    },
    location: {
      type: locationSchema,
      default: null,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
    imageUrl: {
      type: String,
      default: null,
      trim: true,
    },
  },
  baseSchemaOptions
);

vehicleSchema.pre('validate', function normalizeVehicle(next) {
  if (this.conductionNumber) {
    this.conductionNumber = this.conductionNumber
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 7);
  }

  next();
});

export const Vehicle =
  mongoose.models.Vehicle || mongoose.model('Vehicle', vehicleSchema);
