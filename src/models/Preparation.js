import mongoose from 'mongoose';

import {
  PREPARATION_APPROVAL_STATUSES,
  PREPARATION_STATUSES,
  SERVICE_TYPES,
  USER_ROLES,
} from '../constants/enums.js';
import { baseSchemaOptions } from '../utils/schemaOptions.js';

const dispatcherChecklistStepSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    completed: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: false,
  }
);

const preparationSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
      index: true,
    },
    requestedServices: {
      type: [String],
      enum: SERVICE_TYPES,
      default: [],
    },
    customRequests: {
      type: [String],
      default: [],
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    customerContactNo: {
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
      enum: PREPARATION_STATUSES,
      default: 'pending',
      index: true,
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    requestedByRole: {
      type: String,
      enum: USER_ROLES,
      required: true,
    },
    requestedByName: {
      type: String,
      required: true,
      trim: true,
    },
    approvalStatus: {
      type: String,
      enum: PREPARATION_APPROVAL_STATUSES,
      default: 'awaiting_approval',
      index: true,
    },
    approvedByRole: {
      type: String,
      enum: USER_ROLES,
      default: null,
    },
    approvedByName: {
      type: String,
      default: null,
      trim: true,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    dispatcherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    dispatcherChecklist: {
      type: [dispatcherChecklistStepSchema],
      default: [],
    },
    completedAt: {
      type: Date,
      default: null,
    },
    readyForReleaseAt: {
      type: Date,
      default: null,
    },
  },
  baseSchemaOptions
);

export const Preparation =
  mongoose.models.Preparation ||
  mongoose.model('Preparation', preparationSchema);
