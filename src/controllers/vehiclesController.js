import { Vehicle } from '../models/Vehicle.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

const buildVehicleFilters = (query) => {
  const filters = {};

  if (query.status) {
    filters.status = query.status;
  }

  if (query.search) {
    const pattern = new RegExp(query.search, 'i');
    filters.$or = [
      { unitName: pattern },
      { variation: pattern },
      { conductionNumber: pattern },
      { bodyColor: pattern },
    ];
  }

  return filters;
};

const requireVehicle = async (id) => {
  const vehicle = await Vehicle.findById(id);

  if (!vehicle) {
    const error = new Error('Vehicle not found.');
    error.statusCode = 404;
    throw error;
  }

  return vehicle;
};

export const listVehicles = asyncHandler(async (req, res) => {
  const vehicles = await Vehicle.find(buildVehicleFilters(req.query)).sort({
    createdAt: -1,
  });

  sendSuccess(res, {
    data: vehicles,
    message: 'Vehicles fetched successfully.',
  });
});

export const getVehicleById = asyncHandler(async (req, res) => {
  const vehicle = await requireVehicle(req.params.id);

  sendSuccess(res, {
    data: vehicle,
    message: 'Vehicle fetched successfully.',
  });
});

export const createVehicle = asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.create(req.body);
  const savedVehicle = await requireVehicle(vehicle.id);

  sendSuccess(res, {
    status: 201,
    data: savedVehicle,
    message: 'Vehicle created successfully.',
  });
});

export const updateVehicle = asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!vehicle) {
    const error = new Error('Vehicle not found.');
    error.statusCode = 404;
    throw error;
  }

  const savedVehicle = await requireVehicle(vehicle.id);

  sendSuccess(res, {
    data: savedVehicle,
    message: 'Vehicle updated successfully.',
  });
});

export const deleteVehicle = asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findByIdAndDelete(req.params.id);

  if (!vehicle) {
    const error = new Error('Vehicle not found.');
    error.statusCode = 404;
    throw error;
  }

  sendSuccess(res, {
    data: vehicle,
    message: 'Vehicle deleted successfully.',
  });
});
