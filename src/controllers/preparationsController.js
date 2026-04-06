import { Preparation } from '../models/Preparation.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import {
  notifyPreparationCreated,
  notifyPreparationUpdated,
} from '../services/notificationDispatchers.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

const dispatchNotificationTask = (task, label) => {
  void task.catch((error) => {
    console.error(`Notification dispatch failed (${label}):`, error);
  });
};

const preparationPopulation = [
  {
    path: 'vehicleId',
    select: 'unitName variation conductionNumber bodyColor status',
  },
  {
    path: 'dispatcherId',
    select: 'firstName lastName email role',
  },
];

const buildFilters = (query) => {
  const filters = {};

  if (query.status) {
    filters.status = query.status;
  }

  if (query.approvalStatus) {
    filters.approvalStatus = query.approvalStatus;
  }

  if (query.dispatcherId) {
    filters.dispatcherId = query.dispatcherId;
  }

  if (query.vehicleId) {
    filters.vehicleId = query.vehicleId;
  }

  return filters;
};

const requireVehicle = async (vehicleId) => {
  const vehicle = await Vehicle.findById(vehicleId);

  if (!vehicle) {
    const error = new Error('Vehicle not found.');
    error.statusCode = 400;
    throw error;
  }

  return vehicle;
};

const requireDispatcher = async (dispatcherId) => {
  if (!dispatcherId) {
    return null;
  }

  const dispatcher = await User.findById(dispatcherId);

  if (!dispatcher) {
    const error = new Error('Dispatcher not found.');
    error.statusCode = 400;
    throw error;
  }

  return dispatcher;
};

const requireOptionalRequester = async (requesterId) => {
  if (!requesterId) {
    return null;
  }

  const requester = await User.findById(requesterId);

  if (!requester) {
    const error = new Error('Requester not found.');
    error.statusCode = 400;
    throw error;
  }

  return requester;
};

const requirePreparation = async (id) => {
  const preparation = await Preparation.findById(id).populate(
    preparationPopulation
  );

  if (!preparation) {
    const error = new Error('Preparation record not found.');
    error.statusCode = 404;
    throw error;
  }

  return preparation;
};

const validatePayload = async (payload) => {
  await Promise.all([
    requireVehicle(payload.vehicleId),
    requireDispatcher(payload.dispatcherId),
    requireOptionalRequester(payload.requestedByUserId),
  ]);
};

export const listPreparations = asyncHandler(async (req, res) => {
  const preparations = await Preparation.find(buildFilters(req.query))
    .populate(preparationPopulation)
    .sort({ createdAt: -1 });

  sendSuccess(res, {
    data: preparations,
    message: 'Preparation records fetched successfully.',
  });
});

export const getPreparationById = asyncHandler(async (req, res) => {
  const preparation = await requirePreparation(req.params.id);

  sendSuccess(res, {
    data: preparation,
    message: 'Preparation record fetched successfully.',
  });
});

export const createPreparation = asyncHandler(async (req, res) => {
  await validatePayload(req.body ?? {});
  const preparation = await Preparation.create(req.body);
  const savedPreparation = await requirePreparation(preparation.id);
  dispatchNotificationTask(
    notifyPreparationCreated(savedPreparation),
    'preparation create'
  );

  sendSuccess(res, {
    status: 201,
    data: savedPreparation,
    message: 'Preparation record created successfully.',
  });
});

export const updatePreparation = asyncHandler(async (req, res) => {
  const previousPreparation = await requirePreparation(req.params.id);
  const existingPreparation = await Preparation.findById(req.params.id);

  if (!existingPreparation) {
    const error = new Error('Preparation record not found.');
    error.statusCode = 404;
    throw error;
  }

  await validatePayload({
    vehicleId: req.body?.vehicleId ?? existingPreparation.vehicleId,
    dispatcherId:
      req.body?.dispatcherId === undefined
        ? existingPreparation.dispatcherId
        : req.body.dispatcherId,
    requestedByUserId:
      req.body?.requestedByUserId === undefined
        ? existingPreparation.requestedByUserId
        : req.body.requestedByUserId,
  });

  await Preparation.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  const savedPreparation = await requirePreparation(req.params.id);
  dispatchNotificationTask(
    notifyPreparationUpdated({
      previousPreparation,
      nextPreparation: savedPreparation,
    }),
    'preparation update'
  );

  sendSuccess(res, {
    data: savedPreparation,
    message: 'Preparation record updated successfully.',
  });
});

export const deletePreparation = asyncHandler(async (req, res) => {
  const preparation = await Preparation.findByIdAndDelete(req.params.id);

  if (!preparation) {
    const error = new Error('Preparation record not found.');
    error.statusCode = 404;
    throw error;
  }

  sendSuccess(res, {
    data: preparation,
    message: 'Preparation record deleted successfully.',
  });
});
