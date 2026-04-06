import { UnitAgentAllocation } from '../models/UnitAgentAllocation.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import {
  notifyUnitAgentAllocationCreated,
  notifyUnitAgentAllocationUpdated,
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
    path: 'salesAgentId',
    select: 'firstName lastName email role managerId',
  },
  {
    path: 'vehicleId',
    select: 'unitName variation conductionNumber bodyColor status',
  },
];

const buildFilters = (query) => {
  const filters = {};

  if (query.managerId) {
    filters.managerId = query.managerId;
  }

  if (query.salesAgentId) {
    filters.salesAgentId = query.salesAgentId;
  }

  if (query.status) {
    filters.status = query.status;
  }

  return filters;
};

const requireUserRole = async (userId, label, role) => {
  const user = await User.findById(userId);

  if (!user) {
    const error = new Error(`${label} not found.`);
    error.statusCode = 400;
    throw error;
  }

  if (user.role !== role) {
    const error = new Error(`${label} must have the role ${role}.`);
    error.statusCode = 400;
    throw error;
  }

  return user;
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

const requireAllocation = async (id) => {
  const allocation = await UnitAgentAllocation.findById(id).populate(
    allocationPopulation
  );

  if (!allocation) {
    const error = new Error('Unit agent allocation not found.');
    error.statusCode = 404;
    throw error;
  }

  return allocation;
};

const validatePayload = async ({ managerId, salesAgentId, vehicleId, currentId }) => {
  const [manager, salesAgent, vehicle, duplicate] = await Promise.all([
    requireUserRole(managerId, 'Manager', 'manager'),
    requireUserRole(salesAgentId, 'Sales agent', 'sales_agent'),
    requireVehicle(vehicleId),
    UnitAgentAllocation.findOne({
      vehicleId,
      ...(currentId ? { _id: { $ne: currentId } } : {}),
    }),
  ]);

  if (duplicate) {
    const error = new Error('That unit is already assigned to another sales agent.');
    error.statusCode = 409;
    throw error;
  }

  if (String(salesAgent.managerId ?? '') !== String(manager.id)) {
    salesAgent.managerId = manager.id;
    await salesAgent.save();
  }

  return {
    managerId: manager.id,
    salesAgentId: salesAgent.id,
    vehicleId: vehicle.id,
  };
};

export const listUnitAgentAllocations = asyncHandler(async (req, res) => {
  const allocations = await UnitAgentAllocation.find(buildFilters(req.query))
    .populate(allocationPopulation)
    .sort({ createdAt: -1 });

  sendSuccess(res, {
    data: allocations,
    message: 'Unit agent allocations fetched successfully.',
  });
});

export const getUnitAgentAllocationById = asyncHandler(async (req, res) => {
  const allocation = await requireAllocation(req.params.id);

  sendSuccess(res, {
    data: allocation,
    message: 'Unit agent allocation fetched successfully.',
  });
});

export const createUnitAgentAllocation = asyncHandler(async (req, res) => {
  const payload = await validatePayload(req.body ?? {});
  const allocation = await UnitAgentAllocation.create({
    ...req.body,
    ...payload,
  });

  const savedAllocation = await requireAllocation(allocation.id);
  dispatchNotificationTask(
    notifyUnitAgentAllocationCreated(savedAllocation),
    'unit agent allocation create'
  );

  sendSuccess(res, {
    status: 201,
    data: savedAllocation,
    message: 'Unit agent allocation created successfully.',
  });
});

export const updateUnitAgentAllocation = asyncHandler(async (req, res) => {
  const existingAllocation = await requireAllocation(req.params.id);
  const payload = await validatePayload({
    ...(req.body ?? {}),
    currentId: req.params.id,
  });

  await UnitAgentAllocation.findByIdAndUpdate(
    req.params.id,
    {
      ...req.body,
      ...payload,
    },
    {
      new: true,
      runValidators: true,
    }
  );

  const savedAllocation = await requireAllocation(req.params.id);
  dispatchNotificationTask(
    notifyUnitAgentAllocationUpdated({
      previousAllocation: existingAllocation,
      nextAllocation: savedAllocation,
    }),
    'unit agent allocation update'
  );

  sendSuccess(res, {
    data: savedAllocation,
    message: 'Unit agent allocation updated successfully.',
  });
});

export const deleteUnitAgentAllocation = asyncHandler(async (req, res) => {
  const allocation = await UnitAgentAllocation.findByIdAndDelete(req.params.id);

  if (!allocation) {
    const error = new Error('Unit agent allocation not found.');
    error.statusCode = 404;
    throw error;
  }

  sendSuccess(res, {
    data: allocation,
    message: 'Unit agent allocation deleted successfully.',
  });
});
