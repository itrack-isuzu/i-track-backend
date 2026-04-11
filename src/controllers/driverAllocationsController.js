import { ACTIVE_ALLOCATION_STATUSES } from '../constants/enums.js';
import { DriverAllocation } from '../models/DriverAllocation.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import { analyzeDriverBehavior } from '../services/driverAi/behaviorAnalysisService.js';
import {
  isDriverInTransitHeartbeatDue,
  notifyDriverAllocationCreated,
  notifyDriverAllocationDeleted,
  notifyDriverInTransitHeartbeat,
  notifyDriverAllocationUpdated,
} from '../services/notificationDispatchers.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

const dispatchNotificationTask = (task, label) => {
  void task.catch((error) => {
    console.error(`Notification dispatch failed (${label}):`, error);
  });
};

const allocationPopulation = [
  {
    path: 'managerId',
    select: 'firstName lastName email role',
  },
  {
    path: 'driverId',
    select: 'firstName lastName email phone role',
  },
  {
    path: 'vehicleId',
    select: 'unitName variation conductionNumber bodyColor status',
  },
];
const COMPLETED_ALLOCATION_STATUSES = new Set(['completed', 'delivered']);
const IN_TRANSIT_ALLOCATION_STATUS = 'in_transit';

const buildAllocationFilters = (query) => {
  const filters = {};

  if (query.status) {
    filters.status = query.status;
  }

  if (query.driverId) {
    filters.driverId = query.driverId;
  }

  if (query.vehicleId) {
    filters.vehicleId = query.vehicleId;
  }

  return filters;
};

const requireAllocation = async (id) => {
  const allocation = await DriverAllocation.findById(id).populate(
    allocationPopulation
  );

  if (!allocation) {
    const error = new Error('Driver allocation not found.');
    error.statusCode = 404;
    throw error;
  }

  return allocation;
};

const requireUserDocument = async (id, label) => {
  const user = await User.findById(id);

  if (!user) {
    const error = new Error(`${label} not found.`);
    error.statusCode = 400;
    throw error;
  }

  return user;
};

const requireVehicleDocument = async (id) => {
  const vehicle = await Vehicle.findById(id);

  if (!vehicle) {
    const error = new Error('Vehicle not found.');
    error.statusCode = 400;
    throw error;
  }

  return vehicle;
};

const assertDriverRole = (driver) => {
  if (driver.role !== 'driver') {
    const error = new Error('Selected user is not a driver.');
    error.statusCode = 400;
    throw error;
  }
};

const assertRouteStops = ({ pickupLocation, destinationLocation }) => {
  if (!pickupLocation || !destinationLocation) {
    const error = new Error('Pickup and destination locations are required.');
    error.statusCode = 400;
    throw error;
  }

  if (pickupLocation.address === destinationLocation.address) {
    const error = new Error(
      'Pickup and destination must be different locations.'
    );
    error.statusCode = 400;
    throw error;
  }
};

const parseFiniteNumber = (value, label) => {
  const parsedValue =
    typeof value === 'number' ? value : Number(String(value ?? '').trim());

  if (!Number.isFinite(parsedValue)) {
    const error = new Error(`${label} is required.`);
    error.statusCode = 400;
    throw error;
  }

  return parsedValue;
};

const buildValidatedLiveLocationPayload = (value) => {
  if (!value || typeof value !== 'object') {
    const error = new Error('Driver live location is required.');
    error.statusCode = 400;
    throw error;
  }

  const latitude = parseFiniteNumber(value.latitude, 'Latitude');
  const longitude = parseFiniteNumber(value.longitude, 'Longitude');

  if (latitude < -90 || latitude > 90) {
    const error = new Error('Latitude must be between -90 and 90.');
    error.statusCode = 400;
    throw error;
  }

  if (longitude < -180 || longitude > 180) {
    const error = new Error('Longitude must be between -180 and 180.');
    error.statusCode = 400;
    throw error;
  }

  const accuracyValue =
    value.accuracy === undefined || value.accuracy === null
      ? null
      : parseFiniteNumber(value.accuracy, 'Accuracy');
  const speedValue =
    value.speed === undefined || value.speed === null
      ? null
      : parseFiniteNumber(value.speed, 'Speed');
  const headingValue =
    value.heading === undefined || value.heading === null
      ? null
      : parseFiniteNumber(value.heading, 'Heading');
  const timestampValue =
    value.timestamp === undefined || value.timestamp === null
      ? new Date()
      : new Date(value.timestamp);

  if (Number.isNaN(timestampValue.getTime())) {
    const error = new Error('Timestamp must be a valid date.');
    error.statusCode = 400;
    throw error;
  }

  return {
    latitude,
    longitude,
    accuracy: accuracyValue === null ? null : Math.max(accuracyValue, 0),
    speed: speedValue === null ? null : Math.max(speedValue, 0),
    heading: headingValue,
    timestamp: timestampValue,
    updatedAt: timestampValue,
  };
};

const assertActiveAllocationAvailability = async ({
  driverId,
  vehicleId,
  currentAllocationId,
}) => {
  const exclusionFilter = currentAllocationId
    ? { _id: { $ne: currentAllocationId } }
    : {};

  const [driverConflict, vehicleConflict] = await Promise.all([
    DriverAllocation.findOne({
      driverId,
      status: { $in: ACTIVE_ALLOCATION_STATUSES },
      ...exclusionFilter,
    }),
    DriverAllocation.findOne({
      vehicleId,
      status: { $in: ACTIVE_ALLOCATION_STATUSES },
      ...exclusionFilter,
    }),
  ]);

  if (driverConflict) {
    const error = new Error('That driver already has an active allocation.');
    error.statusCode = 409;
    throw error;
  }

  if (vehicleConflict) {
    const error = new Error('That vehicle already has an active allocation.');
    error.statusCode = 409;
    throw error;
  }
};

const resolveVehicleStatus = (status) => {
  if (status === 'in_transit') {
    return 'in_transit';
  }

  if (ACTIVE_ALLOCATION_STATUSES.includes(status)) {
    return 'in_stockyard';
  }

  return 'available';
};

const reconcileVehicleStatus = async (vehicleId) => {
  const latestActiveAllocation = await DriverAllocation.findOne({
    vehicleId,
    status: { $in: ACTIVE_ALLOCATION_STATUSES },
  }).sort({ createdAt: -1 });

  const nextStatus = latestActiveAllocation
    ? resolveVehicleStatus(latestActiveAllocation.status)
    : 'available';

  await Vehicle.findByIdAndUpdate(vehicleId, {
    status: nextStatus,
  });
};

const buildAllocationLifecyclePayload = (existingAllocation, nextPayload) => {
  const nextStatus = nextPayload.status ?? existingAllocation.status;
  const lifecyclePayload = {};

  if (
    nextStatus === 'in_transit' &&
    !existingAllocation.startTime &&
    !nextPayload.startTime
  ) {
    lifecyclePayload.startTime = new Date();
  }

  if (
    COMPLETED_ALLOCATION_STATUSES.has(nextStatus) &&
    (existingAllocation.status !== nextStatus ||
      !existingAllocation.endTime ||
      !existingAllocation.actualDuration)
  ) {
    const completionTime = nextPayload.endTime
      ? new Date(nextPayload.endTime)
      : new Date();
    const startTime =
      lifecyclePayload.startTime ??
      nextPayload.startTime ??
      existingAllocation.startTime ??
      null;

    lifecyclePayload.endTime = completionTime;

    if (startTime) {
      lifecyclePayload.actualDuration = Math.max(
        1,
        Math.round(
          (completionTime.getTime() - new Date(startTime).getTime()) / 60000
        )
      );
    }
  }

  return lifecyclePayload;
};

const prepareAllocationPayload = async (payload, currentAllocationId = null) => {
  const {
    managerId,
    vehicleId,
    driverId,
    pickupLocation,
    destinationLocation,
  } = payload;

  assertRouteStops({ pickupLocation, destinationLocation });

  const [vehicle, driver] = await Promise.all([
    requireVehicleDocument(vehicleId),
    requireUserDocument(driverId, 'Driver'),
  ]);

  assertDriverRole(driver);

  if (managerId) {
    await requireUserDocument(managerId, 'Manager');
  }

  if (ACTIVE_ALLOCATION_STATUSES.includes(payload.status ?? 'pending')) {
    await assertActiveAllocationAvailability({
      driverId,
      vehicleId,
      currentAllocationId,
    });
  }

  return {
    ...payload,
    managerId: managerId ?? null,
    vehicleId: vehicle.id,
    driverId: driver.id,
  };
};

export const listDriverAllocations = asyncHandler(async (req, res) => {
  const allocations = await DriverAllocation.find(buildAllocationFilters(req.query))
    .populate(allocationPopulation)
    .sort({ createdAt: -1 });

  sendSuccess(res, {
    data: allocations,
    message: 'Driver allocations fetched successfully.',
  });
});

export const getDriverAllocationById = asyncHandler(async (req, res) => {
  const allocation = await requireAllocation(req.params.id);

  sendSuccess(res, {
    data: allocation,
    message: 'Driver allocation fetched successfully.',
  });
});

export const createDriverAllocation = asyncHandler(async (req, res) => {
  const payload = await prepareAllocationPayload(req.body);
  const allocation = await DriverAllocation.create(payload);

  await reconcileVehicleStatus(payload.vehicleId);

  const savedAllocation = await requireAllocation(allocation.id);
  dispatchNotificationTask(
    notifyDriverAllocationCreated(savedAllocation),
    'driver allocation create'
  );

  sendSuccess(res, {
    status: 201,
    data: savedAllocation,
    message: 'Driver allocation created successfully.',
  });
});

export const updateDriverAllocation = asyncHandler(async (req, res) => {
  const previousAllocation = await requireAllocation(req.params.id);
  const existingAllocation = await DriverAllocation.findById(req.params.id);

  if (!existingAllocation) {
    const error = new Error('Driver allocation not found.');
    error.statusCode = 404;
    throw error;
  }

  const nextPayload = {
    ...existingAllocation.toObject(),
    ...req.body,
  };
  const lifecyclePayload = buildAllocationLifecyclePayload(
    existingAllocation,
    nextPayload
  );

  const payload = await prepareAllocationPayload(
    {
      ...nextPayload,
      ...lifecyclePayload,
    },
    existingAllocation.id
  );

  await DriverAllocation.findByIdAndUpdate(req.params.id, payload, {
    new: true,
    runValidators: true,
  });

  await Promise.all([
    reconcileVehicleStatus(existingAllocation.vehicleId),
    reconcileVehicleStatus(payload.vehicleId),
  ]);

  const savedAllocation = await requireAllocation(req.params.id);
  dispatchNotificationTask(
    notifyDriverAllocationUpdated({
      previousAllocation,
      nextAllocation: savedAllocation,
    }),
    'driver allocation update'
  );

  sendSuccess(res, {
    data: savedAllocation,
    message: 'Driver allocation updated successfully.',
  });
});

export const updateDriverAllocationLiveLocation = asyncHandler(async (req, res) => {
  const existingAllocation = await DriverAllocation.findById(req.params.id);

  if (!existingAllocation) {
    const error = new Error('Driver allocation not found.');
    error.statusCode = 404;
    throw error;
  }

  if (existingAllocation.status !== IN_TRANSIT_ALLOCATION_STATUS) {
    const error = new Error(
      'Live location can only be updated while the trip is in transit.'
    );
    error.statusCode = 409;
    throw error;
  }

  const currentLocation = buildValidatedLiveLocationPayload(
    req.body?.currentLocation ?? req.body
  );
  const analysisResult = await analyzeDriverBehavior({
    allocation: existingAllocation,
    incomingLocation: currentLocation,
  });
  const heartbeatDue =
    analysisResult.acceptedPoint &&
    isDriverInTransitHeartbeatDue(existingAllocation, currentLocation.timestamp);
  const updatePayload = analysisResult.acceptedPoint
    ? {
        currentLocation: analysisResult.currentLocation,
        routeProgress: analysisResult.routeProgress,
        aiState: analysisResult.aiState,
        behaviorEvents: analysisResult.behaviorEvents,
        aiAlerts: analysisResult.aiAlerts,
        driverScore: analysisResult.driverScore,
      }
    : {
        aiState: analysisResult.aiState,
      };

  if (heartbeatDue) {
    updatePayload.aiState = {
      ...(updatePayload.aiState ?? existingAllocation.aiState ?? {}),
      lastTransitHeartbeatNotifiedAt: currentLocation.timestamp,
    };
  }

  await DriverAllocation.findByIdAndUpdate(
    req.params.id,
    updatePayload,
    {
      new: true,
      runValidators: true,
    }
  );

  const savedAllocation = await requireAllocation(req.params.id);

  if (heartbeatDue) {
    dispatchNotificationTask(
      notifyDriverInTransitHeartbeat(savedAllocation),
      'driver in transit heartbeat'
    );
  }

  sendSuccess(res, {
    data: {
      ...savedAllocation.toJSON(),
      aiAnalysis: {
        acceptedPoint: analysisResult.acceptedPoint,
        ignoredReason: analysisResult.reason,
        createdEvents: analysisResult.createdEvents,
        createdAlerts: analysisResult.createdAlerts,
        driverScore: analysisResult.driverScore,
        diagnostics: analysisResult.diagnostics ?? null,
      },
    },
    message: 'Driver live location updated successfully.',
  });
});

export const deleteDriverAllocation = asyncHandler(async (req, res) => {
  const existingAllocation = await requireAllocation(req.params.id);
  const allocation = await DriverAllocation.findByIdAndDelete(req.params.id);

  if (!allocation) {
    const error = new Error('Driver allocation not found.');
    error.statusCode = 404;
    throw error;
  }

  await reconcileVehicleStatus(allocation.vehicleId);
  dispatchNotificationTask(
    notifyDriverAllocationDeleted(existingAllocation),
    'driver allocation delete'
  );

  sendSuccess(res, {
    data: allocation,
    message: 'Driver allocation deleted successfully.',
  });
});
