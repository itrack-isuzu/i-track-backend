import { DriverAllocation } from '../models/DriverAllocation.js';
import { withAccessScope } from '../middleware/operationAccess.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { deliveryDelayReference } from '../services/deliveryDelayService.js';

export const listDeliveryDelayHistory = asyncHandler(async (req, res) => {
  const filters = req.query.driverId ? { driverId: req.query.driverId } : {};
  const allocations = await DriverAllocation.find(withAccessScope(req, filters))
    .populate('driverId', 'firstName lastName').populate('vehicleId', 'unitName variation conductionNumber')
    .sort({ startTime: -1 });
  const data = allocations.flatMap((allocation) => {
    const recorded = allocation.behaviorEvents?.find((event) => event.type === 'eta_delay_exceeded');
    const reference = deliveryDelayReference(allocation);
    if (!recorded && !reference) return [];
    const details = reference ?? recorded.metadata;
    return [{ id: allocation.id, driverId: String(allocation.driverId?._id ?? ''),
      driver: `${allocation.driverId?.firstName ?? ''} ${allocation.driverId?.lastName ?? ''}`.trim() || 'Deleted driver',
      unit: `${allocation.vehicleId?.unitName ?? ''} ${allocation.vehicleId?.variation ?? ''}`.trim() || 'Deleted unit',
      conductionNumber: allocation.vehicleId?.conductionNumber ?? '', origin: allocation.pickupLocation.name,
      destination: allocation.destinationLocation.name, scheduledShipmentAt: allocation.scheduledShipmentAt,
      expectedArrivalAt: details.expectedArrivalAt, actualReferenceAt: details.actualReferenceAt,
      detectedAt: recorded?.detectedAt ?? allocation.endTime ?? null,
      minutesDelayed: details.minutesDelayed, status: details.status,
      source: recorded ? 'Recorded threshold event' : 'Calculated from recorded trip times',
      reason: 'Elapsed time relative to the recorded trip plan. This does not establish the cause of delay.',
    }];
  });
  sendSuccess(res, { data });
});
