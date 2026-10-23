import { Router } from 'express';
import { AuditEvent } from '../models/AuditEvent.js';
import { AuthEvent } from '../models/AuthEvent.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { requireRoles } from '../middleware/operationAccess.js';

const router = Router();
router.get('/', requireRoles('admin', 'supervisor'), asyncHandler(async (req, res) => {
  const [events, auth] = await Promise.all([
    AuditEvent.find({ outcome: { $ne: 'failed' } }).sort({ createdAt: -1 }).limit(2000).lean(),
    AuthEvent.find().sort({ createdAt: -1 }).limit(1000).lean(),
  ]);
  const entries = [
    ...events.map((event) => ({ ...event, id: String(event._id), timestamp: event.createdAt,
      description: `${event.description}${event.outcome === 'pending' ? ' (Outcome awaiting confirmation)' : ''}` })),
    ...auth.map((event) => ({ id: String(event._id), userId: String(event.userId ?? ''), user: event.name,
      userEmail: event.email, role: event.role, action: event.eventType.toUpperCase(), module: 'Authentication',
      description: `${event.name} ${event.eventType === 'login' ? 'signed in' : 'signed out'}.`, timestamp: event.createdAt })),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  sendSuccess(res, { data: entries });
}));
// Client-only operations such as a PDF export still use the authenticated actor.
router.post('/', asyncHandler(async (req, res) => {
  if (req.body?.action !== 'EXPORT') return res.status(400).json({ success: false, message: 'Only export events may be submitted by a client.' });
  const actor = req.authUser;
  const event = await AuditEvent.create({ userId: actor.id, user: `${actor.firstName} ${actor.lastName}`.trim(),
    userEmail: actor.email, role: actor.role, action: 'EXPORT', outcome: 'succeeded',
    module: String(req.body.module ?? 'Reports').slice(0, 80),
    description: String(req.body.description ?? 'Exported a report.').slice(0, 1000) });
  sendSuccess(res, { status: 201, data: event });
}));
export default router;
