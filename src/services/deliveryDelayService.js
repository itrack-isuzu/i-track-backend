import { DriverAllocation } from '../models/DriverAllocation.js';
export const ALLOWABLE_ETA_DELAY_MINUTES = 120;
export function deliveryDelayReference(allocation, now = new Date()) {
  const start = allocation.startTime ? new Date(allocation.startTime).getTime() : NaN;
  const duration = allocation.estimatedDuration;
  const complete = ['completed', 'delivered'].includes(allocation.status);
  const actual = complete ? allocation.endTime ? new Date(allocation.endTime).getTime() : NaN : now.getTime();
  if (!['in_transit', 'completed', 'delivered'].includes(allocation.status) || !Number.isFinite(start) ||
      !Number.isFinite(actual) || typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || actual < start) return null;
  const expected = start + duration * 60_000;
  const minutesDelayed = Math.max(0, Math.floor((actual - expected) / 60_000));
  if (minutesDelayed <= ALLOWABLE_ETA_DELAY_MINUTES) return null;
  return { expectedArrivalAt: new Date(expected), actualReferenceAt: new Date(actual), minutesDelayed,
    status: complete ? 'Completed beyond ETA allowance' : 'Uncompleted beyond ETA allowance' };
}
export async function recordSeriousDeliveryDelay(allocation, now = new Date()) {
  const reference = deliveryDelayReference(allocation, now);
  if (!reference) return;
  await DriverAllocation.updateOne({ _id: allocation.id, 'behaviorEvents.type': { $ne: 'eta_delay_exceeded' } }, {
    $push: { behaviorEvents: { type: 'eta_delay_exceeded', severity: 'high', detectedAt: now,
      metadata: { ...reference, allowanceMinutes: ALLOWABLE_ETA_DELAY_MINUTES, allocationStatus: allocation.status } } },
  });
}
