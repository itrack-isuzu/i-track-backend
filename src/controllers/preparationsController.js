import { Preparation } from '../models/Preparation.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

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

  sendSuccess(res, {
    status: 201,
    data: savedPreparation,
    message: 'Preparation record created successfully.',
  });
});

export const updatePreparation = asyncHandler(async (req, res) => {
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
  });

  await Preparation.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  const savedPreparation = await requirePreparation(req.params.id);

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
