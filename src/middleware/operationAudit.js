import { AuditEvent } from '../models/AuditEvent.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const modules = {
  users: 'Users', vehicles: 'Vehicle Stocks', 'driver-allocations': 'Driver Allocation',
  'unit-agent-allocations': 'Unit Allocation', preparations: 'Preparation', 'test-drive-bookings': 'Test Drive',
};
const safeFields = ['status', 'approvalStatus', 'vehicleId', 'driverId', 'managerId', 'salesAgentId',
  'unitName', 'variation', 'conductionNumber', 'firstName', 'lastName', 'email', 'role', 'isActive',
  'pickupLocation', 'destinationLocation', 'scheduledShipmentAt', 'estimatedDuration', 'stopRequest', 'rejectionRequest'];
export const auditSummary = (record) => Object.fromEntries(safeFields
  .filter((key) => record?.[key] !== undefined)
  .map((key) => [key, record[key]?.toObject?.() ?? record[key]]));

export function requireActionReason(value) {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < 5 || reason.length > 1000) {
    throw Object.assign(new Error('Enter a reason between 5 and 1000 characters before confirming this action.'), { statusCode: 400 });
  }
  return reason;
}

// Write an intent before a mutation. Finalize it before acknowledging success so
// a database failure cannot silently discard an operational audit entry.
export const operationAudit = asyncHandler(async (req, res, next) => {
  const [resource, id, operation] = req.path.split('/').filter(Boolean);
  if (!modules[resource] || !['POST', 'PATCH', 'DELETE'].includes(req.method) ||
      operation === 'live-location' || resource === 'users' && ['directory', 'audit-events'].includes(id)) return next();
  const destructive = req.method === 'DELETE' || req.body?.status === 'cancelled' || req.body?.isActive === false;
  let headerReason = req.get('X-Action-Reason');
  if (headerReason) { try { headerReason = decodeURIComponent(headerReason); } catch { /* Accept older clients sending plain text. */ } }
  const reason = destructive || operation === 'stop-request' || operation === 'rejection-request'
    ? requireActionReason(headerReason || req.body?.reason || req.body?.reviewNotes)
    : '';
  req.actionReason = reason;
  const actor = req.authUser;
  let action = req.method === 'DELETE' ? 'DELETE' : req.method === 'POST' && !operation ? 'CREATE' : 'UPDATE';
  if (req.body?.status === 'cancelled') action = 'CANCEL';
  else if (operation === 'accept') action = 'ACCEPT';
  else if (operation?.endsWith('request')) action = req.method === 'POST' ? 'REQUEST' : req.body?.action === 'approve' ? 'APPROVE' : 'REJECT';
  else if (resource === 'driver-allocations' && actor.role === 'driver' && req.body?.status === 'assigned') action = 'ACCEPT';
  else if (resource === 'driver-allocations' && req.body?.driverId) action = 'ASSIGN';
  else if (resource === 'unit-agent-allocations' && req.method === 'POST') action = 'ALLOCATE';
  else if (['approved', 'rejected'].includes(req.body?.approvalStatus)) action = req.body.approvalStatus === 'approved' ? 'APPROVE' : 'REJECT';
  const entry = await AuditEvent.create({
    userId: actor.id, user: `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || actor.email,
    userEmail: actor.email, role: actor.role, action, module: modules[resource], entityId: id ?? '', reason,
    description: `${action} ${modules[resource]}${id ? ` ${id}` : ''}${reason ? ` — Reason: ${reason}` : ''}`,
    after: auditSummary(req.body),
  });
  const originalJson = res.json.bind(res);
  let finalizing = false;
  res.json = (body) => {
    if (finalizing) return originalJson(body);
    finalizing = true;
    const succeeded = res.statusCode < 400 && body?.success !== false;
    void AuditEvent.findByIdAndUpdate(entry.id, { $set: {
      outcome: succeeded ? 'succeeded' : 'failed',
      entityId: id ?? body?.data?.id ?? body?.data?._id ?? '',
      before: auditSummary(req.accessRecord),
      after: succeeded ? auditSummary(body?.data) : entry.after,
    } }).then(() => originalJson(body)).catch((error) => {
      console.error('[audit] Audit finalization failed; saved intent retained:', error.message);
      res.status(503);
      originalJson({ success: false, message: 'The action may have completed, but audit confirmation failed. Refresh this record before retrying.' });
    });
    return res;
  };
  next();
});
