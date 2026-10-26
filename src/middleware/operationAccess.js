import { DriverAllocation } from '../models/DriverAllocation.js';
import { UnitAgentAllocation } from '../models/UnitAgentAllocation.js';
import { Preparation } from '../models/Preparation.js';
import { TestDriveBooking } from '../models/TestDriveBooking.js';
import { Vehicle } from '../models/Vehicle.js';
import { User } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const MANAGEMENT_ROLES = ['admin', 'supervisor'];
export const WEB_OPERATION_ROLES = [...MANAGEMENT_ROLES, 'manager', 'sales_agent'];
export const authenticatedId = (req) => String(req.authUser?.id ?? req.authUser?._id ?? '');
export const entityId = (value) => String(value?._id ?? value?.id ?? value ?? '');
export const isManagement = (req) => MANAGEMENT_ROLES.includes(req.authUser?.role);
export const accessError = (message = 'You are not authorized to perform this operation.', statusCode = 403) =>
  Object.assign(new Error(message), { statusCode });

export const requireRoles = (...roles) => (req, res, next) => {
  if (!req.authUser) return next(accessError('Please sign in again.', 401));
  if (!roles.includes(req.authUser.role)) return next(accessError());
  next();
};

// Combine client filters with the server scope instead of allowing either to override it.
export const withAccessScope = (req, filters = {}) =>
  req.accessFilters && Object.keys(req.accessFilters).length
    ? { $and: [filters, req.accessFilters] }
    : filters;

const scopedVehicleIds = async (req) => {
  const role = req.authUser.role;
  const id = authenticatedId(req);
  const records = role === 'driver'
    ? await DriverAllocation.find({ driverId: id }).select('vehicleId')
    : await UnitAgentAllocation.find({ [role === 'manager' ? 'managerId' : 'salesAgentId']: id }).select('vehicleId');
  return records.map((record) => entityId(record.vehicleId));
};

const dispatcherVehicleIds = async (req) => {
  const records = await Preparation.find({ approvalStatus: 'approved', $or: [{ dispatcherId: authenticatedId(req) }, { dispatcherId: null }] }).select('vehicleId');
  return records.map((record) => entityId(record.vehicleId));
};

const vehicleReadScope = async (req) => {
  const role = req.authUser.role;
  if (role === 'driver') return { _id: { $in: await scopedVehicleIds(req) } };
  if (role === 'dispatcher') return { _id: { $in: await dispatcherVehicleIds(req) } };
  if (role === 'manager' || role === 'sales_agent') {
    const [ownedIds, assigned] = await Promise.all([
      scopedVehicleIds(req), UnitAgentAllocation.find({}).select('vehicleId'),
    ]);
    // A scoped allocation list cannot establish whether another user's stock is shared.
    const assignedIds = assigned.map((record) => entityId(record.vehicleId));
    return { $or: [{ _id: { $in: ownedIds } }, { _id: { $nin: assignedIds }, status: { $in: ['available', 'in_stockyard'] } }] };
  }
  return {};
};

export const assertWorkflowVehicleAccess = async (req, vehicleId) => {
  if (isManagement(req)) return;
  const scope = await vehicleReadScope(req);
  const visible = await Vehicle.exists({ $and: [{ _id: vehicleId }, scope] });
  if (!visible) throw accessError('Select a vehicle assigned to your team or available as shared stock.');
};

export const resourceScope = (resource) => asyncHandler(async (req, res, next) => {
  const role = req.authUser?.role;
  const id = authenticatedId(req);
  if (!id) throw accessError('Please sign in again.', 401);
  let scope = {};
  if (!MANAGEMENT_ROLES.includes(role)) {
    if (resource === 'vehicles') {
      scope = await vehicleReadScope(req);
    } else if (resource === 'unitAllocations') {
      if (role === 'manager') scope = { managerId: id };
      else if (role === 'sales_agent') scope = { salesAgentId: id };
      else if (role === 'driver') scope = { vehicleId: { $in: await scopedVehicleIds(req) } };
      else if (role === 'dispatcher') scope = { vehicleId: { $in: await dispatcherVehicleIds(req) } };
    } else if (resource === 'driverAllocations') {
      if (role === 'driver') scope = { driverId: id };
      else if (role === 'dispatcher') scope = { _id: { $in: [] } };
      else if (role === 'manager' || role === 'sales_agent') {
        const vehicles = { vehicleId: { $in: await scopedVehicleIds(req) } };
        scope = role === 'manager' ? { $or: [{ managerId: id }, vehicles] } : vehicles;
      }
    } else if (resource === 'preparations') {
      if (role === 'dispatcher') {
        scope = { approvalStatus: 'approved', $or: [{ dispatcherId: id }, { dispatcherId: null }] };
      } else if (role === 'manager' || role === 'sales_agent') {
        scope = { $or: [{ requestedByUserId: id }, { vehicleId: { $in: await scopedVehicleIds(req) } }] };
      } else scope = { _id: { $in: [] } };
    } else if (resource === 'bookings') {
      if (role === 'manager' || role === 'sales_agent') {
        const [vehicles, agents] = await Promise.all([
          scopedVehicleIds(req),
          role === 'manager' ? User.find({ role: 'sales_agent', managerId: id }).select('_id') : [],
        ]);
        const requesterIds = [id, ...agents.map(entityId)];
        scope = { $or: [{ requestedByUserId: { $in: requesterIds } }, { vehicleId: { $in: vehicles } }] };
      } else scope = { _id: { $in: [] } };
    }
  }
  req.accessFilters = scope;
  next();
});

const resourceModels = {
  vehicles: Vehicle,
  unitAllocations: UnitAgentAllocation,
  driverAllocations: DriverAllocation,
  preparations: Preparation,
  bookings: TestDriveBooking,
};

export const requireScopedRecord = (resource) => asyncHandler(async (req, res, next) => {
  const record = await resourceModels[resource].findOne(withAccessScope(req, { _id: req.params.id }));
  if (!record) throw accessError('Record not found or unavailable to your account.', 404);
  req.accessRecord = record;
  next();
});

export const guardVehicleDeletion = asyncHandler(async (req, res, next) => {
  const vehicleId = req.params.id;
  const references = await Promise.all([
    DriverAllocation.exists({ vehicleId }),
    Preparation.exists({ vehicleId }),
    TestDriveBooking.exists({ vehicleId }),
    UnitAgentAllocation.exists({ vehicleId }),
  ]);
  if (references.some(Boolean)) {
    throw accessError('This vehicle has allocation, shipment, preparation, or booking history and cannot be deleted.', 409);
  }
  next();
});

export const guardVehicleStatusUpdate = asyncHandler(async (req, res, next) => {
  if (req.body?.status === undefined) return next();
  const vehicleId = req.params.id;
  const [trip, preparation, vehicle] = await Promise.all([
    DriverAllocation.findOne({ vehicleId, status: { $in: ['pending', 'assigned', 'in_transit'] } }).sort({ createdAt: -1 }),
    Preparation.findOne({ vehicleId, status: { $ne: 'rejected' } }).sort({ updatedAt: -1, createdAt: -1 }),
    Vehicle.findById(vehicleId),
  ]);
  const expected = trip ? trip.status === 'in_transit' ? 'in_transit' : 'in_stockyard'
    : preparation?.status === 'completed' || vehicle?.status === 'completed' ? 'completed'
      : ['pending', 'in_dispatch', 'ready_for_release'].includes(preparation?.status) ? 'under_preparation' : null;
  if (expected && req.body.status !== expected) throw accessError('Update the related shipment or preparation workflow to change this vehicle status.', 409);
  next();
});

export const ensureVehicleCanBeScheduled = async (vehicleId) => {
  const [vehicle, preparation] = await Promise.all([
    Vehicle.findById(vehicleId),
    Preparation.findOne({ vehicleId, status: { $ne: 'rejected' } }).sort({ updatedAt: -1, createdAt: -1 }),
  ]);
  if (!vehicle) throw accessError('Vehicle not found.', 400);
  if (['completed', 'maintenance', 'under_preparation'].includes(vehicle.status) || ['pending', 'in_dispatch', 'ready_for_release', 'completed'].includes(preparation?.status)) {
    throw accessError('This vehicle is released, under preparation, or unavailable for scheduling.', 409);
  }
};

export const guardShipmentVehicle = asyncHandler(async (req, res, next) => {
  if (req.body?.vehicleId && (!req.accessRecord || entityId(req.accessRecord.vehicleId) !== entityId(req.body.vehicleId))) {
    await ensureVehicleCanBeScheduled(req.body.vehicleId);
  }
  next();
});

const driverTransitions = {
  pending: ['assigned', 'cancelled'],
  assigned: ['pending', 'in_transit', 'cancelled'],
  in_transit: ['completed', 'delivered', 'cancelled'],
  completed: [], delivered: [], cancelled: [],
};
const shipmentFields = ['managerId', 'vehicleId', 'driverId', 'pickupLocation', 'destinationLocation', 'scheduledShipmentAt', 'estimatedDuration', 'notes', 'status', 'routeProgress', 'eta'];

export const guardDriverAllocationCreate = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return next(accessError('A shipment object is required.', 400));
  if (req.body?.status && !['pending', 'assigned'].includes(req.body.status)) {
    return next(accessError('New shipments must be pending or assigned.', 400));
  }
  if (Object.keys(req.body ?? {}).some((key) => !shipmentFields.includes(key))) {
    return next(accessError('Unsupported shipment field.', 400));
  }
  next();
};

export const guardDriverAllocationUpdate = (req, res, next) => {
  const record = req.accessRecord;
  const driver = req.authUser?.role === 'driver';
  if (driver && entityId(record.driverId) !== authenticatedId(req)) return next(accessError());
  const allowed = driver ? ['status', 'routeProgress', 'eta'] : shipmentFields;
  if (Object.keys(req.body ?? {}).some((key) => !allowed.includes(key))) {
    return next(accessError('This shipment field cannot be changed by your account.', driver ? 403 : 400));
  }
  const nextStatus = req.body?.status ?? record.status;
  if (driver && record.rejectionRequest?.status === 'pending' && nextStatus !== record.status) {
    return next(accessError('Wait for the administrator or supervisor to review your rejection request.', 409));
  }
  if (driver && record.stopRequest?.status === 'pending' && nextStatus !== record.status) {
    return next(accessError('Wait for the administrator or supervisor to review your cancellation request.', 409));
  }
  if (nextStatus !== record.status && !driverTransitions[record.status]?.includes(nextStatus)) {
    return next(accessError(`Shipment status cannot change from ${record.status} to ${nextStatus}.`, 409));
  }
  if (driver && ((nextStatus === 'cancelled') || (record.status === 'assigned' && nextStatus === 'pending'))) {
    return next(accessError('Request approval to stop or cancel a trip.'));
  }
  if (['in_transit', 'completed', 'delivered', 'cancelled'].includes(record.status)) {
    const immutableFields = ['vehicleId', 'driverId', 'pickupLocation', 'destinationLocation'];
    const changed = immutableFields.some((key) => {
      if (req.body?.[key] === undefined) return false;
      if (key.endsWith('Id')) return entityId(req.body[key]) !== entityId(record[key]);
      return ['name', 'address', 'latitude', 'longitude'].some((field) => String(req.body[key]?.[field] ?? '') !== String(record[key]?.[field] ?? ''));
    });
    if (changed) {
      return next(accessError('Vehicle, driver, and route cannot be changed after a trip starts or ends.', 409));
    }
  }
  next();
};

export const requireAssignedDriver = (req, res, next) => {
  if (req.authUser?.role !== 'driver' || entityId(req.accessRecord?.driverId) !== authenticatedId(req)) {
    return next(accessError('Only the assigned driver can perform this trip action.'));
  }
  next();
};

export const guardDriverAllocationDeletion = (req, res, next) => {
  if (req.accessRecord?.status === 'in_transit') return next(accessError('An in-transit shipment cannot be deleted.', 409));
  next();
};
