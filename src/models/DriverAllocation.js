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

const liveLocationSchema = new mongoose.Schema(
  {
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    accuracy: {
      type: Number,
      default: null,
      min: 0,
    },
    speed: {
      type: Number,
      default: null,
      min: 0,
    },
    heading: {
      type: Number,
      default: null,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  }
);

const aiRecentLocationSchema = new mongoose.Schema(
  {
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    accuracy: {
      type: Number,
      default: null,
      min: 0,
    },
    speedKph: {
      type: Number,
      default: 0,
      min: 0,
    },
    heading: {
      type: Number,
      default: null,
    },
    timestamp: {
      type: Date,
      required: true,
    },
  },
  {
    _id: false,
  }
);

const behaviorEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
    },
    severity: {
      type: String,
      default: 'medium',
      trim: true,
    },
    detectedAt: {
      type: Date,
      required: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    _id: false,
  }
);

const aiAlertSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
    },
    severity: {
      type: String,
      default: 'medium',
      trim: true,
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
    detectedAt: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      default: 'open',
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    _id: false,
  }
);

const driverScoreSchema = new mongoose.Schema(
  {
    score: {
      type: Number,
      default: 100,
      min: 0,
      max: 100,
    },
    rating: {
      type: String,
      default: 'Excellent',
      trim: true,
    },
    totalDeductions: {
      type: Number,
      default: 0,
      min: 0,
    },
    eventCounts: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  }
);

const aiStateSchema = new mongoose.Schema(
  {
    recentLocations: {
      type: [aiRecentLocationSchema],
      default: [],
    },
    alertState: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastIgnoredPoint: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    lastAnalyzedAt: {
      type: Date,
      default: null,
    },
    lastAcceptedPointAt: {
      type: Date,
      default: null,
    },
    lastTransitHeartbeatNotifiedAt: {
      type: Date,
      default: null,
    },
    latestRouteDistanceMeters: {
      type: Number,
      default: null,
      min: 0,
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
    currentLocation: {
      type: liveLocationSchema,
      default: null,
    },
    aiState: {
      type: aiStateSchema,
      default: () => ({}),
    },
    behaviorEvents: {
      type: [behaviorEventSchema],
      default: [],
    },
    aiAlerts: {
      type: [aiAlertSchema],
      default: [],
    },
    driverScore: {
      type: driverScoreSchema,
      default: () => ({}),
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
