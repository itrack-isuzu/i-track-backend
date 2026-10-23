import mongoose from 'mongoose';

import { VEHICLE_STATUSES } from '../constants/enums.js';
import { baseSchemaOptions } from '../utils/schemaOptions.js';

const locationSchema = new mongoose.Schema(
  {
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
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
      match: [/^[A-Z0-9]{6,7}$/, 'Conduction number must contain 6 to 7 letters or digits.'],
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

export const Vehicle =
  mongoose.models.Vehicle || mongoose.model('Vehicle', vehicleSchema);
