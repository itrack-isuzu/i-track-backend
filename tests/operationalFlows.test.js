import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as geo from '../src/utils/driverAiGeo.js';
import { DRIVER_AI_THRESHOLDS, DRIVER_AI_EVENT_TYPES } from '../src/config/driverAiConfig.js';

async function fixture(file, dependencies, names) {
  const source = (await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'))
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/g, '')
    .replace(/export (const|async function|function) /g, '$1 ');
  return new Function(...Object.keys(dependencies), `${source}\nreturn { ${names.join(',')} };`)(...Object.values(dependencies));
}
const actor = { id: 'driver-1', firstName: 'Test', lastName: 'Driver', email: 'driver@example.test', role: 'driver' };
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('operational reasons are required before a destructive mutation or audit write', async () => {
  let writes = 0, nextCalls = 0;
  const { operationAudit } = await fixture('middleware/operationAudit.js', { asyncHandler: (fn) => fn,
    AuditEvent: { create: async () => { writes++; return { id: 'audit-1' }; } },
  }, ['operationAudit']);
  for (const reason of [undefined, '', '  ', 'abc', 'x'.repeat(1001)]) {
    await assert.rejects(operationAudit({ path: '/vehicles/unit-1', method: 'DELETE', authUser: actor, get: () => reason }, response(), () => nextCalls++), (error) => error.statusCode === 400);
  }
  assert.equal(writes, 0); assert.equal(nextCalls, 0);
});

test('audit saves authenticated actor, affected entity, reason, before/after and outcome before success', async () => {
  let intent, finalized;
  const { operationAudit } = await fixture('middleware/operationAudit.js', { asyncHandler: (fn) => fn,
    AuditEvent: { create: async (record) => { intent = record; return { id: 'audit-1', ...record }; },
      findByIdAndUpdate: async (id, update) => { finalized = update.$set; } },
  }, ['operationAudit']);
  const req = { path: '/driver-allocations/trip-1/accept', method: 'POST', authUser: actor,
    body: { userId: 'spoof', password: 'must-not-log' }, get: () => '', accessRecord: { status: 'pending' } };
  const res = response();
  await operationAudit(req, res, () => res.json({ success: true, data: { id: 'trip-1', status: 'assigned' } }));
  await new Promise(setImmediate);
  assert.equal(intent.userId, actor.id); assert.equal(intent.role, 'driver'); assert.equal(intent.action, 'ACCEPT');
  assert.equal(finalized.entityId, 'trip-1'); assert.equal(finalized.outcome, 'succeeded');
  assert.deepEqual(finalized.before, { status: 'pending' }); assert.deepEqual(finalized.after, { status: 'assigned' });
  assert.ok(!JSON.stringify(intent).includes('must-not-log')); assert.equal(res.body.success, true);
});

test('an audit database failure prevents the operational action from running', async () => {
  let mutated = false;
  const { operationAudit } = await fixture('middleware/operationAudit.js', { asyncHandler: (fn) => fn,
    AuditEvent: { create: async () => { throw new Error('fixture database unavailable'); } },
  }, ['operationAudit']);
  await assert.rejects(operationAudit({ path: '/vehicles/unit-1', method: 'DELETE', authUser: actor,
    get: () => 'Duplicate stock entry' }, response(), () => { mutated = true; }));
  assert.equal(mutated, false);
});

test('cancellation reason is persisted and unsuccessful operations are marked failed', async () => {
  let saved, final;
  const { operationAudit } = await fixture('middleware/operationAudit.js', { asyncHandler: (fn) => fn,
    AuditEvent: { create: async (data) => { saved = data; return { id: 'a1', ...data }; }, findByIdAndUpdate: async (id, data) => { final = data.$set; } },
  }, ['operationAudit']);
  const res = response();
  await operationAudit({ path: '/test-drive-bookings/b1', method: 'PATCH', authUser: actor,
    body: { status: 'cancelled' }, get: () => 'Customer changed schedule' }, res,
  () => res.status(409).json({ success: false, message: 'Booking already completed.' }));
  await new Promise(setImmediate);
  assert.equal(saved.action, 'CANCEL'); assert.equal(saved.reason, 'Customer changed schedule'); assert.equal(final.outcome, 'failed');
});

test('accept endpoint atomically accepts only the assigned pending booking and blocks duplicate acceptance', async () => {
  const stored = { id: 'trip-1', driverId: 'driver-1', status: 'pending', rejectionRequest: { status: 'none' } };
  const model = {
    findById: () => ({ populate: async () => ({ ...stored }) }),
    findOneAndUpdate: (query, update) => ({ populate: async () => {
      if (stored.driverId !== query.driverId || stored.status !== query.status || stored.rejectionRequest.status === 'pending') return null;
      Object.assign(stored, update.$set); return { ...stored };
    } }),
  };
  const { acceptDriverAllocation } = await fixture('controllers/driverAllocationsController.js', {
    asyncHandler: (fn) => fn, DriverAllocation: model,
    notifyDriverAllocationUpdated: async () => [], sendSuccess: (res, body) => { res.body = body; },
  }, ['acceptDriverAllocation']);
  const req = { params: { id: 'trip-1' }, authUser: actor };
  const unauthorized = response(); await acceptDriverAllocation({ ...req, authUser: { ...actor, id: 'different-driver' } }, unauthorized);
  assert.equal(unauthorized.statusCode, 409); assert.equal(stored.status, 'pending');
  stored.rejectionRequest.status = 'pending';
  const blocked = response(); await acceptDriverAllocation(req, blocked); assert.equal(blocked.statusCode, 409);
  stored.rejectionRequest.status = 'none';
  const accepted = response(); await acceptDriverAllocation(req, accepted); assert.equal(accepted.body.data.status, 'assigned');
  const duplicate = response(); await acceptDriverAllocation(req, duplicate); assert.equal(duplicate.statusCode, 409);
});

test('driver rejection request retains booking status and notifies approvers; reviewer approval is conditional', async () => {
  const stored = { id: 'trip-1', status: 'pending', driverId: { id: actor.id, firstName: actor.firstName }, vehicleId: { id: 'unit-1' }, rejectionRequest: { status: 'none' } };
  const notifications = [];
  const { requireActionReason } = await fixture('middleware/operationAudit.js', { asyncHandler: (fn) => fn }, ['requireActionReason']);
  const model = { findOneAndUpdate: (query, update) => ({ populate: async () => {
    if (!query.status.$in.includes(stored.status)) return null;
    const condition = query['rejectionRequest.status'];
    if (typeof condition === 'string' ? stored.rejectionRequest.status !== condition : stored.rejectionRequest.status === 'pending') return null;
    for (const [key, value] of Object.entries(update.$set)) {
      if (key.startsWith('rejectionRequest.')) stored.rejectionRequest[key.split('.')[1]] = value;
      else stored[key] = value;
    }
    return stored;
  } }) };
  const { requestDriverAllocationRejection, reviewDriverAllocationRejection } = await fixture('controllers/driverAllocationsController.js', {
    asyncHandler: (fn) => fn, DriverAllocation: model, requireActionReason,
    createNotificationsForRoles: async (data) => { notifications.push(data); },
    createNotificationsForUsers: async (data) => { notifications.push(data); },
    sendSuccess: (res, body) => { res.body = body; },
  }, ['requestDriverAllocationRejection', 'reviewDriverAllocationRejection']);
  const req = { params: { id: stored.id }, authUser: actor, body: { reason: 'Vehicle safety issue reported' } };
  await requestDriverAllocationRejection(req, response());
  assert.equal(stored.status, 'pending'); assert.equal(stored.rejectionRequest.status, 'pending');
  assert.deepEqual(notifications[0].roles, ['admin', 'supervisor']);
  const duplicate = response(); await requestDriverAllocationRejection(req, duplicate); assert.equal(duplicate.statusCode, 409);
  await reviewDriverAllocationRejection({ ...req, authUser: { ...actor, id: 'supervisor-1', role: 'supervisor' },
    body: { action: 'reject', reviewNotes: 'Alternative transport has been arranged' } }, response());
  assert.equal(stored.status, 'pending'); assert.equal(stored.rejectionRequest.status, 'rejected');
  assert.equal(notifications[1].title, 'Booking rejection denied');
  const oldReview = response(); await reviewDriverAllocationRejection({ ...req, body: { action: 'approve', reviewNotes: 'Duplicate review is not permitted' } }, oldReview);
  assert.equal(oldReview.statusCode, 409); assert.equal(stored.status, 'pending');
});

test('serious delay uses a real start and positive duration, excludes exactly two hours and preserves completion reference', async () => {
  const { deliveryDelayReference } = await fixture('services/deliveryDelayService.js', {}, ['deliveryDelayReference']);
  const startTime = new Date('2026-10-24T00:00:00Z');
  const trip = { status: 'in_transit', startTime, estimatedDuration: 30 };
  assert.equal(deliveryDelayReference(trip, new Date('2026-10-24T02:30:00Z')), null);
  assert.equal(deliveryDelayReference(trip, new Date('2026-10-24T02:31:00Z')).minutesDelayed, 121);
  assert.equal(deliveryDelayReference({ ...trip, estimatedDuration: 0 }), null);
  assert.equal(deliveryDelayReference({ ...trip, startTime: null }), null);
  assert.equal(deliveryDelayReference({ ...trip, status: 'assigned' }), null);
  const completed = deliveryDelayReference({ ...trip, status: 'completed', endTime: '2026-10-24T03:00:00Z' }, new Date('2026-10-24T20:00:00Z'));
  assert.equal(completed.minutesDelayed, 150); assert.equal(completed.status, 'Completed beyond ETA allowance');
});

test('Expo queues push tickets separately from delivery receipts and stores the inbox before sending', async () => {
  const saved = [], deliveries = [];
  class Expo {
    static isExpoPushToken(token) { return token.startsWith('ExpoPushToken['); }
    chunkPushNotifications(messages) { return [messages]; }
    async sendPushNotificationsAsync(messages) { assert.equal(saved.length, 1); assert.equal(messages[0].channelId, 'itrack-alerts'); return [{ status: 'ok', id: 'receipt-1' }]; }
  }
  const { createNotificationsForUsers } = await fixture('services/notificationsService.js', {
    Expo, env: {}, User: { find: () => ({ select: async () => [{ id: actor.id, pushTokens: [{ token: 'ExpoPushToken[fixture]', isActive: true }] }] }) },
    Notification: { insertMany: async (records) => { saved.push(...records); return records.map((record) => ({ ...record, id: 'notification-1' })); },
      updateOne: async (query, update) => { deliveries.push(update.$push.pushDeliveries); } },
  }, ['createNotificationsForUsers']);
  const result = await createNotificationsForUsers({ userIds: [actor.id], title: 'Booking', message: 'Assigned to you', data: { entityType: 'driver_allocation', entityId: 'trip-1' } });
  assert.equal(result.length, 1); assert.equal(deliveries[0].status, 'queued'); assert.equal(deliveries[0].ticketId, 'receipt-1');
  assert.ok(deliveries[0].nextCheckAt > new Date());
});

test('push re-registration validates Expo tokens and transfers a device away from a previous account', async () => {
  let transferred, saved = false;
  class Expo { static isExpoPushToken(token) { return /^ExpoPushToken\[.+\]$/.test(token); } }
  const user = { pushTokens: [], save: async () => { saved = true; } };
  const { registerUserPushToken } = await fixture('services/notificationsService.js', { Expo, env: {},
    User: { findById: async () => user, updateMany: async (query, update) => { transferred = { query, update }; } },
  }, ['registerUserPushToken']);
  await assert.rejects(registerUserPushToken({ userId: actor.id, token: 'invalid' }), (error) => error.statusCode === 400);
  await registerUserPushToken({ userId: actor.id, token: 'ExpoPushToken[fixture]', platform: 'android' });
  assert.equal(transferred.query._id.$ne, actor.id); assert.equal(transferred.update.$pull.pushTokens.token, 'ExpoPushToken[fixture]');
  assert.equal(user.pushTokens[0].isActive, true); assert.equal(saved, true);
});

test('provider receipt errors are persisted and DeviceNotRegistered tokens are removed', async () => {
  const updates = [], removed = [];
  class Expo {
    chunkPushNotificationReceiptIds(ids) { return [ids]; }
    async getPushNotificationReceiptsAsync() { return { 'receipt-1': { status: 'error', details: { error: 'DeviceNotRegistered' } } }; }
  }
  const { checkPushReceipts } = await fixture('services/pushReceiptsService.js', { Expo, env: {},
    Notification: {
      find: () => ({ select: () => ({ limit: async () => [{ id: 'notification-1', pushDeliveries: [{ token: 'ExpoPushToken[fixture]',
        ticketId: 'receipt-1', status: 'queued', attempts: 0, nextCheckAt: new Date(Date.now() - 1000) }] }] }) }),
      updateOne: async (query, update) => { updates.push(update.$set); },
    },
    User: { updateMany: async (query, update) => { removed.push(update.$pull); } },
  }, ['checkPushReceipts']);
  await checkPushReceipts();
  assert.equal(updates[0]['pushDeliveries.$[delivery].status'], 'error');
  assert.equal(updates[0]['pushDeliveries.$[delivery].error'], 'DeviceNotRegistered');
  assert.equal(removed[0].pushTokens.token, 'ExpoPushToken[fixture]');
});

test('missing or inaccessible notification records return an explicit listing fallback, never an untrusted URL', async () => {
  let lookup;
  const { resolveNotificationTarget } = await fixture('services/notificationTargetService.js', {
    mongoose: { isValidObjectId: () => true }, DriverAllocation: { exists: async (query) => { lookup = query; return false; } },
    Preparation: {}, TestDriveBooking: {}, UnitAgentAllocation: {}, Vehicle: {},
    resourceScope: () => (req, res, next) => { req.accessFilters = { driverId: actor.id }; next(); },
    withAccessScope: (req, filter) => ({ $and: [filter, req.accessFilters] }),
  }, ['resolveNotificationTarget']);
  const result = await resolveNotificationTarget({}, { data: { entityType: 'driver_allocation', entityId: 'removed-trip', url: 'https://untrusted.example' } });
  assert.equal(result.available, false); assert.equal(result.entityId, ''); assert.match(result.message, /Showing the related listing/);
  assert.deepEqual(lookup.$and[1], { driverId: actor.id }); assert.ok(!('url' in result));
});

test('fresh stationary GPS jitter refreshes the heartbeat without moving the vehicle, and speed uses metres/second', async () => {
  const { analyzeDriverBehavior } = await fixture('services/driverAi/behaviorAnalysisService.js', {
    ...geo, DRIVER_AI_THRESHOLDS, DRIVER_AI_EVENT_TYPES, calculateDriverScore: () => ({ score: 100 }),
    shouldCreateAlert: () => false, createDriverBehaviorAlert: async () => ({}),
  }, ['analyzeDriverBehavior']);
  const time = new Date('2026-10-24T08:00:00Z');
  const previous = { latitude: 14.5, longitude: 121, accuracy: 12, speedKph: 0, timestamp: time };
  const allocation = { status: 'in_transit', startTime: time, estimatedDuration: 30,
    pickupLocation: { latitude: 14.5, longitude: 121 }, destinationLocation: { latitude: 14.6, longitude: 121.1 },
    currentLocation: previous, aiState: { recentLocations: [previous] },
    behaviorEvents: [{ type: 'eta_delay_exceeded', detectedAt: time, metadata: { minutesDelayed: 121 } }],
  };
  const jitter = await analyzeDriverBehavior({ allocation, incomingLocation: {
    latitude: 14.50002, longitude: 121.00002, accuracy: 12, speed: 0, timestamp: new Date(+time + 15_000),
  } });
  assert.equal(jitter.acceptedPoint, true); assert.equal(jitter.currentLocation.latitude, previous.latitude);
  assert.equal(jitter.currentLocation.longitude, previous.longitude); assert.equal(+jitter.currentLocation.timestamp, +time + 15_000);
  assert.equal(jitter.currentLocation.speed, 0); assert.equal(jitter.behaviorEvents[0].type, 'eta_delay_exceeded');
  const moving = await analyzeDriverBehavior({ allocation, incomingLocation: {
    latitude: 14.5005, longitude: 121.0005, accuracy: 10, speed: 10, timestamp: new Date(+time + 15_000),
  } });
  assert.equal(moving.acceptedPoint, true); assert.equal(moving.diagnostics.speedKph, 36);
  const poor = await analyzeDriverBehavior({ allocation, incomingLocation: {
    latitude: 14.5, longitude: 121, accuracy: 80, speed: 0, timestamp: new Date(+time + 15_000),
  } });
  assert.equal(poor.acceptedPoint, false); assert.equal(+poor.currentLocation.timestamp, +time);
});
