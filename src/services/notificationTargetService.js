import mongoose from 'mongoose';
import { DriverAllocation } from '../models/DriverAllocation.js';
import { Preparation } from '../models/Preparation.js';
import { TestDriveBooking } from '../models/TestDriveBooking.js';
import { UnitAgentAllocation } from '../models/UnitAgentAllocation.js';
import { Vehicle } from '../models/Vehicle.js';
import { resourceScope, withAccessScope } from '../middleware/operationAccess.js';

const entities = {
  driver_allocation: [DriverAllocation, 'driverAllocations'],
  preparation: [Preparation, 'preparations'],
  test_drive_booking: [TestDriveBooking, 'bookings'],
  unit_agent_allocation: [UnitAgentAllocation, 'unitAllocations'],
  vehicle: [Vehicle, 'vehicles'],
};
export async function resolveNotificationTarget(req, notification) {
  const data = notification.data ?? {};
  const entityType = String(data.entityType ?? (data.vehicleId ? 'vehicle' : ''));
  const entityId = String(data.entityId ?? data.vehicleId ?? '');
  const entity = entities[entityType];
  if (!entity) return { entityType: '', entityId: '', available: false, message: '' };
  await new Promise((resolve, reject) => resourceScope(entity[1])(req, {}, (error) => error ? reject(error) : resolve()));
  const available = mongoose.isValidObjectId(entityId) && Boolean(await entity[0].exists(withAccessScope(req, { _id: entityId })));
  const relatedAllocation = available && entityType === 'unit_agent_allocation'
    ? await UnitAgentAllocation.findById(entityId).select('vehicleId') : null;
  return { entityType, entityId: available ? entityId : '', available, vehicleId: relatedAllocation ? String(relatedAllocation.vehicleId ?? '') : '',
    message: available ? '' : 'This record was removed or is no longer available to your account. Showing the related listing.' };
}
