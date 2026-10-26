import { ACTIVE_ALLOCATION_STATUSES } from '../constants/enums.js';
import { DRIVER_AI_THRESHOLDS } from '../config/driverAiConfig.js';
import { DriverAllocation } from '../models/DriverAllocation.js';
import { Preparation } from '../models/Preparation.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import { analyzeDriverBehavior } from '../services/driverAi/behaviorAnalysisService.js';
import {
  isDriverInTransitHeartbeatDue,
  notifyDriverAllocationCreated,
  notifyDriverAllocationCompletionRequested,
  notifyDriverAllocationDeleted,
  notifyDriverInTransitHeartbeat,
  notifyDriverAllocationUpdated,
  notifyDriverStopTripRequested,
  notifyDriverStopTripReviewed,
} from '../services/notificationDispatchers.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { parseFiniteNumber, parseCoordinates } from '../utils/inputValidation.js';
import { withAccessScope } from '../middleware/operationAccess.js';
import { scanDriverSafetyAlerts } from '../services/driverSafetyMonitorService.js';
import { createNotificationsForRoles, createNotificationsForUsers } from '../services/notificationsService.js';
import { requireActionReason } from '../middleware/operationAudit.js';
import { recordSeriousDeliveryDelay } from '../services/deliveryDelayService.js';

const dispatchNotificationTask = (task, label) => {
  void task.catch((error) => {
    console.error(`Notification dispatch failed (${label}):`, error);
  });
};
let lastListSafetyScanAt = 0;

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

const parseOptionalDate = (value, label) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    const error = new Error(`${label} must be a valid date and time.`);
    error.statusCode = 400;
    throw error;
  }

  return parsedDate;
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

  const now = Date.now();
  const timestampTime = timestampValue.getTime();
  const maxFutureSkewMs =
    DRIVER_AI_THRESHOLDS.gps.maxClientTimestampSkewSeconds * 1000;
  const maxAgeMs = DRIVER_AI_THRESHOLDS.gps.maxClientLocationAgeSeconds * 1000;

  if (timestampTime - now > maxFutureSkewMs) {
    const error = new Error('GPS timestamp is too far in the future.');
    error.statusCode = 400;
    throw error;
  }

  if (now - timestampTime > maxAgeMs) {
    const error = new Error('GPS timestamp is too old. Send a fresh location update.');
    error.statusCode = 400;
    throw error;
  }

  if (
    accuracyValue !== null &&
    accuracyValue > DRIVER_AI_THRESHOLDS.gps.maxAcceptedAccuracyForStorageMeters
  ) {
    const error = new Error(
      `GPS accuracy is too low. Accuracy must be within ${DRIVER_AI_THRESHOLDS.gps.maxAcceptedAccuracyForStorageMeters} meters.`
    );
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

  let nextStatus;
  if (latestActiveAllocation) {
    nextStatus = resolveVehicleStatus(latestActiveAllocation.status);
  } else {
    const [vehicle, latestPreparation] = await Promise.all([
      Vehicle.findById(vehicleId),
      Preparation.findOne({ vehicleId, status: { $ne: 'rejected' } })
        .sort({ updatedAt: -1, createdAt: -1 }),
    ]);
    if (vehicle?.status === 'maintenance') {
      nextStatus = 'maintenance';
    } else if (latestPreparation?.status === 'completed') {
      nextStatus = 'completed';
    } else if (['pending', 'in_dispatch', 'ready_for_release'].includes(latestPreparation?.status)) {
      nextStatus = 'under_preparation';
    } else {
      nextStatus = vehicle?.status === 'completed' ? 'completed' : 'available';
    }
  }

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
  const pickupCoordinates = parseCoordinates(pickupLocation, 'Pickup location');
  const destinationCoordinates = parseCoordinates(destinationLocation, 'Destination location');

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
    pickupLocation: { ...pickupLocation, ...pickupCoordinates },
    destinationLocation: { ...destinationLocation, ...destinationCoordinates },
    managerId: managerId ?? null,
    vehicleId: vehicle.id,
    driverId: driver.id,
    scheduledShipmentAt: parseOptionalDate(
      payload.scheduledShipmentAt,
      'Vehicle shipment date'
    ),
  };
};

const requireInTransitAllocationForDriverAction = async (id) => {
  const allocation = await DriverAllocation.findById(id);

  if (!allocation) {
    const error = new Error('Driver allocation not found.');
    error.statusCode = 404;
    throw error;
  }

  if (allocation.status !== IN_TRANSIT_ALLOCATION_STATUS) {
    const error = new Error('This action is only available while the trip is in transit.');
    error.statusCode = 409;
    throw error;
  }

  return allocation;
};

const normalizeActionText = (value, fallback = '') =>
  String(value ?? fallback).trim().slice(0, 500);

export const listDriverAllocations = asyncHandler(async (req, res) => {
  if (Date.now() - lastListSafetyScanAt >= 60_000) {
    lastListSafetyScanAt = Date.now();
    void scanDriverSafetyAlerts().catch((error) => {
    console.warn(
      '[driver-safety-monitor] Unable to scan before listing allocations:',
      error instanceof Error ? error.message : error
    );
  });
  }

  const allocations = await DriverAllocation.find(withAccessScope(req, buildAllocationFilters(req.query)))
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

  const updateFilter = { _id: req.params.id, status: existingAllocation.status };
  if (req.authUser.role === 'driver' && payload.status !== existingAllocation.status) {
    updateFilter['stopRequest.status'] = { $ne: 'pending' };
    updateFilter['rejectionRequest.status'] = { $ne: 'pending' };
  }
  // Request reviews and GPS updates own these fields; do not overwrite newer values from a read snapshot.
  const updatePayload = { ...payload };
  for (const field of ['_id', '__v', 'createdAt', 'updatedAt', 'stopRequest', 'rejectionRequest', 'currentLocation', 'aiState', 'behaviorEvents', 'aiAlerts', 'driverScore']) delete updatePayload[field];
  const updatedAllocation = await DriverAllocation.findOneAndUpdate(updateFilter, { $set: updatePayload }, {
    new: true,
    runValidators: true,
  });
  if (!updatedAllocation) return res.status(409).json({ success: false, message: 'The trip or an approval request changed. Refresh the booking before continuing.' });

  await Promise.all([
    reconcileVehicleStatus(existingAllocation.vehicleId),
    reconcileVehicleStatus(payload.vehicleId),
  ]);

  const savedAllocation = await requireAllocation(req.params.id);
  await recordSeriousDeliveryDelay(savedAllocation);
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
        currentLocation: { ...analysisResult.currentLocation, updatedAt: currentLocation.timestamp },
        routeProgress: analysisResult.routeProgress,
        aiState: analysisResult.aiState,
        behaviorEvents: analysisResult.behaviorEvents,
        aiAlerts: analysisResult.aiAlerts,
        driverScore: analysisResult.driverScore,
      }
    : {
        aiState: analysisResult.aiState,
      };

  if (analysisResult.acceptedPoint) {
    updatePayload.aiState.lastGpsLostNotifiedAt = null;
  }

  if (heartbeatDue) {
    updatePayload.aiState = {
      ...(updatePayload.aiState ?? existingAllocation.aiState ?? {}),
      lastTransitHeartbeatNotifiedAt: currentLocation.timestamp,
    };
  }

  await DriverAllocation.findOneAndUpdate(
    { _id: req.params.id, updatedAt: existingAllocation.updatedAt, status: IN_TRANSIT_ALLOCATION_STATUS },
    { $set: updatePayload },
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

export const requestDriverAllocationCompletion = asyncHandler(async (req, res) => {
  const allocation = await requireAllocation(req.params.id);

  if (allocation.status !== IN_TRANSIT_ALLOCATION_STATUS) {
    const error = new Error(
      'Trip completion can only be requested while the trip is in transit.'
    );
    error.statusCode = 409;
    throw error;
  }

  const notifications =
    await notifyDriverAllocationCompletionRequested(allocation);

  if (!notifications.length) {
    const error = new Error(
      'No active admin/supervisor accounts are available to receive this request.'
    );
    error.statusCode = 409;
    throw error;
  }

  sendSuccess(res, {
    data: allocation,
    message: 'Admin/supervisor notified successfully.',
  });
});

export const requestDriverAllocationStop = asyncHandler(async (req, res) => {
  const reason = requireActionReason(req.body?.reason);
  const savedAllocation = await DriverAllocation.findOneAndUpdate(
    { _id: req.params.id, driverId: req.authUser.id, status: 'in_transit', 'stopRequest.status': { $ne: 'pending' } },
    { $set: {
      stopRequest: {
        status: 'pending',
        reason,
        requestedAt: new Date(),
        reviewedAt: null,
        reviewedBy: null,
        reviewNotes: '',
      },
    } },
    {
      new: true,
      runValidators: true,
    }
  ).populate(allocationPopulation);
  if (!savedAllocation) return res.status(409).json({ success: false, message: 'Only your active in-transit trip can be requested for cancellation, and a request must not already be pending.' });

  dispatchNotificationTask(
    notifyDriverStopTripRequested(savedAllocation),
    'driver stop trip request'
  );

  sendSuccess(res, {
    data: savedAllocation,
    message: 'Stop trip request sent successfully.',
  });
});

export const acceptDriverAllocation = asyncHandler(async (req, res) => {
  const previousAllocation = await requireAllocation(req.params.id);
  const allocation = await DriverAllocation.findOneAndUpdate({ _id: req.params.id,
    driverId: req.authUser.id, status: 'pending', 'rejectionRequest.status': { $ne: 'pending' },
  }, { $set: { status: 'assigned' } }, { new: true, runValidators: true }).populate(allocationPopulation);
  if (!allocation) return res.status(409).json({ success: false, message: 'This booking is no longer awaiting your acceptance. Refresh your assignments.' });
  dispatchNotificationTask(notifyDriverAllocationUpdated({ previousAllocation, nextAllocation: allocation }), 'driver booking acceptance');
  sendSuccess(res, { data: allocation, message: 'Booking accepted.' });
});

export const requestDriverAllocationRejection = asyncHandler(async (req, res) => {
  const reason = requireActionReason(req.body?.reason);
  const allocation = await DriverAllocation.findOneAndUpdate({ _id: req.params.id, driverId: req.authUser.id,
    status: { $in: ['pending', 'assigned'] }, 'rejectionRequest.status': { $ne: 'pending' },
  }, { $set: { rejectionRequest: { status: 'pending', reason, requestedAt: new Date(), reviewedAt: null, reviewedBy: null, reviewNotes: '' } } },
  { new: true, runValidators: true }).populate(allocationPopulation);
  if (!allocation) return res.status(409).json({ success: false, message: 'This booking cannot be requested for rejection, or a request is already pending.' });
  dispatchNotificationTask(createNotificationsForRoles({ roles: ['admin', 'supervisor'], type: 'alert',
    title: 'Driver booking rejection needs approval', message: `${allocation.driverId.firstName} requested rejection: ${reason}`,
    data: { entityType: 'driver_allocation', entityId: allocation.id, rejectionRequestStatus: 'pending' },
  }), 'driver rejection request');
  sendSuccess(res, { data: allocation, message: 'Rejection requested; pending administrator or supervisor approval.' });
});

export const reviewDriverAllocationRejection = asyncHandler(async (req, res) => {
  const action = req.body?.action;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ success: false, message: 'Choose approve or reject.' });
  const reviewNotes = requireActionReason(req.body?.reviewNotes);
  const approved = action === 'approve';
  const update = { 'rejectionRequest.status': approved ? 'approved' : 'rejected',
    'rejectionRequest.reviewedAt': new Date(), 'rejectionRequest.reviewedBy': req.authUser.id, 'rejectionRequest.reviewNotes': reviewNotes };
  if (approved) { update.status = 'cancelled'; update.endTime = new Date(); }
  const allocation = await DriverAllocation.findOneAndUpdate({ _id: req.params.id,
    status: { $in: ['pending', 'assigned'] }, 'rejectionRequest.status': 'pending',
  }, { $set: update }, { new: true, runValidators: true }).populate(allocationPopulation);
  if (!allocation) return res.status(409).json({ success: false, message: 'No pending rejection is available. Refresh this booking.' });
  if (approved) await reconcileVehicleStatus(allocation.vehicleId.id);
  dispatchNotificationTask(createNotificationsForUsers({ userIds: [allocation.driverId.id], type: 'driver',
    title: approved ? 'Booking rejection approved' : 'Booking rejection denied', message: reviewNotes,
    data: { entityType: 'driver_allocation', entityId: allocation.id, rejectionRequestStatus: allocation.rejectionRequest.status },
  }), 'driver rejection reviewed');
  sendSuccess(res, { data: allocation, message: approved ? 'Rejection approved; booking cancelled.' : 'Rejection denied; booking remains assigned.' });
});

export const reviewDriverAllocationStopRequest = asyncHandler(async (req, res) => {
  const action = normalizeActionText(req.body?.action).toLowerCase();

  if (!['approve', 'reject'].includes(action)) {
    const error = new Error('Action must be approve or reject.');
    error.statusCode = 400;
    throw error;
  }

  const previousAllocation = await requireAllocation(req.params.id);
  const reviewNotes = requireActionReason(req.body?.reviewNotes);
  const approved = action === 'approve';
  const updatePayload = {
    'stopRequest.status': approved ? 'approved' : 'rejected',
    'stopRequest.reviewedAt': new Date(),
    'stopRequest.reviewedBy': req.authUser.id,
    'stopRequest.reviewNotes': reviewNotes,
  };

  if (approved) {
    updatePayload.status = 'cancelled';
    updatePayload.endTime = new Date();
    updatePayload.actualDuration = previousAllocation.startTime
      ? Math.max(
          1,
          Math.round(
            (updatePayload.endTime.getTime() -
              new Date(previousAllocation.startTime).getTime()) /
              60000
          )
        )
      : previousAllocation.actualDuration;
  }

  const savedAllocation = await DriverAllocation.findOneAndUpdate({ _id: req.params.id, status: 'in_transit', 'stopRequest.status': 'pending' }, { $set: updatePayload }, {
    new: true,
    runValidators: true,
  }).populate(allocationPopulation);
  if (!savedAllocation) return res.status(409).json({ success: false, message: 'No pending cancellation is available for this active trip. Refresh the booking.' });

  if (approved) {
    await reconcileVehicleStatus(savedAllocation.vehicleId.id);
  }

  dispatchNotificationTask(
    notifyDriverStopTripReviewed({
      allocation: savedAllocation,
      approved,
    }),
    'driver stop trip review'
  );

  if (approved) {
    dispatchNotificationTask(
      notifyDriverAllocationUpdated({
        previousAllocation,
        nextAllocation: savedAllocation,
      }),
      'driver allocation stop approval update'
    );
  }

  sendSuccess(res, {
    data: savedAllocation,
    message: approved
      ? 'Stop trip request approved and trip cancelled.'
      : 'Stop trip request rejected.',
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
