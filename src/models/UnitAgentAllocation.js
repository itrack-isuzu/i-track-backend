import mongoose from 'mongoose';

import { ALLOCATION_STATUSES } from '../constants/enums.js';
import { baseSchemaOptions } from '../utils/schemaOptions.js';

const unitAgentAllocationSchema = new mongoose.Schema(
  {
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    salesAgentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ALLOCATION_STATUSES,
      default: 'assigned',
      index: true,
    },
  },
  baseSchemaOptions
);

export const UnitAgentAllocation =
  mongoose.models.UnitAgentAllocation ||
  mongoose.model('UnitAgentAllocation', unitAgentAllocationSchema);
