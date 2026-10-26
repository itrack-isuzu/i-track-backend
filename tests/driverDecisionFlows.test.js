import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIVE_ALLOCATION_STATUSES } from '../src/constants/enums.js';
import { parseCoordinates, parseFiniteNumber } from '../src/utils/inputValidation.js';

async function fixture(file, dependencies, names) {
  const source = (await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'))
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/g, '')
    .replace(/export (const|async function|function) /g, '$1 ');
  return new Function(...Object.keys(dependencies), `${source}\nreturn { ${names.join(',')} };`)(...Object.values(dependencies));
}
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const actor = role => ({ id: role === 'driver' ? 'driver-1' : `${role}-1`, role, firstName: 'Fixture', lastName: role });
const nested = (value, key) => key.split('.').reduce((current, part) => current?.[part], value);
const matches = (value, query) => Object.entries(query).every(([key, expected]) => {
  const actual = key === '_id' ? value.id : nested(value, key);
  if (expected && typeof expected === 'object') {
    if ('$in' in expected) return expected.$in.includes(actual);
    if ('$ne' in expected) return actual !== expected.$ne;
  }
  return actual === expected;
});
const setFields = (target, fields) => {
  for (const [key, value] of Object.entries(fields)) {
    const parts = key.split('.');
    let current = target;
    for (const part of parts.slice(0, -1)) current = current[part] ??= {};
    current[parts.at(-1)] = structuredClone(value);
  }
};

async function harness(status = 'in_transit') {
  const notifications = [], writes = [];
  const stored = {
    id: 'trip-1', driverId: 'driver-1', vehicleId: 'unit-1', managerId: null, status,
    createdAt: new Date('2026-10-26T00:00:00Z'), startTime: status === 'in_transit' ? new Date(Date.now() - 600000) : null,
    pickupLocation: { name: 'Stockyard', address: 'A', latitude: 14.5, longitude: 121 },
    destinationLocation: { name: 'Dealership', address: 'B', latitude: 14.6, longitude: 121.1 },
    stopRequest: { status: 'none' }, rejectionRequest: { status: 'none' },
    currentLocation: { latitude: 14.55, longitude: 121.05 },
  };
  let stockStatus = status === 'in_transit' ? 'in_transit' : 'in_stockyard';
  let beforeWrite;
  const doc = value => value ? { ...structuredClone(value), toObject: () => structuredClone(value) } : null;
  const populated = value => value ? { ...structuredClone(value), driverId: { id: value.driverId, firstName: 'Fixture', lastName: 'Driver' }, vehicleId: { id: value.vehicleId, unitName: 'Isuzu NMR' } } : null;
  const query = value => ({
    then: (resolve, reject) => Promise.resolve(doc(value)).then(resolve, reject),
    populate: async () => populated(value),
    sort() { return this; },
  });
  const model = {
    findById: id => query(id === stored.id ? stored : null),
    findOne: filter => query(matches(stored, filter) ? stored : null),
    findOneAndUpdate: (filter, update) => {
      if (beforeWrite) { const callback = beforeWrite; beforeWrite = null; callback(); }
      if (!matches(stored, filter)) return query(null);
      writes.push({ filter, update }); setFields(stored, update.$set ?? update);
      return query(stored);
    },
  };
  const { requireActionReason } = await fixture('middleware/operationAudit.js', { asyncHandler: fn => fn }, ['requireActionReason']);
  const handlers = await fixture('controllers/driverAllocationsController.js', {
    asyncHandler: fn => fn, DriverAllocation: model, ACTIVE_ALLOCATION_STATUSES,
    Vehicle: { findById: async () => ({ id: 'unit-1', status: stockStatus }), findByIdAndUpdate: async (_, update) => { stockStatus = update.status; } },
    User: { findById: async () => ({ id: 'driver-1', role: 'driver', isActive: true }) },
    Preparation: { findOne: () => ({ sort: async () => null }) },
    requireActionReason, parseCoordinates, parseFiniteNumber,
    notifyDriverStopTripRequested: async record => notifications.push({ kind: 'stop-request', record }),
    notifyDriverStopTripReviewed: async value => notifications.push({ kind: 'stop-reviewed', ...value }),
    notifyDriverAllocationUpdated: async value => notifications.push({ kind: 'updated', ...value }),
    createNotificationsForRoles: async value => notifications.push({ kind: 'approver-inbox', ...value }),
    createNotificationsForUsers: async value => notifications.push({ kind: 'driver-inbox', ...value }),
    recordSeriousDeliveryDelay: async () => {}, sendSuccess: (res, body) => { res.body = { success: true, ...body }; },
  }, ['requestDriverAllocationStop', 'reviewDriverAllocationStopRequest', 'requestDriverAllocationRejection', 'reviewDriverAllocationRejection', 'acceptDriverAllocation', 'updateDriverAllocation']);
  async function call(name, body, role = 'driver') {
    const res = response();
    await handlers[name]({ params: { id: stored.id }, body, authUser: actor(role) }, res);
    return res;
  }
  return { stored, notifications, writes, call, get stockStatus() { return stockStatus; }, interleave: callback => { beforeWrite = callback; } };
}

test('mid-delivery cancellation requires a reason, remains in transit pending review, and prevents duplicate requests', async () => {
  const h = await harness();
  for (const reason of ['', 'abc', 'x'.repeat(1001)]) await assert.rejects(h.call('requestDriverAllocationStop', { reason }), { statusCode: 400 });
  assert.equal(h.writes.length, 0);
  const results = await Promise.all([
    h.call('requestDriverAllocationStop', { reason: 'Engine overheated during delivery' }),
    h.call('requestDriverAllocationStop', { reason: 'Repeated tap should not duplicate the request' }),
  ]);
  assert.deepEqual(results.map(res => res.statusCode).sort(), [200, 409]);
  assert.equal(h.stored.status, 'in_transit'); assert.equal(h.stockStatus, 'in_transit');
  assert.equal(h.stored.stopRequest.status, 'pending');
  assert.equal(h.stored.stopRequest.reason, 'Engine overheated during delivery');
  assert.equal(h.notifications.filter(item => item.kind === 'stop-request').length, 1);
  const finish = await h.call('updateDriverAllocation', { status: 'completed' });
  assert.equal(finish.statusCode, 409, 'direct completion cannot bypass pending cancellation review');
  assert.equal(h.stored.status, 'in_transit');
});

test('admin/supervisor approval cancels a trip; denial preserves it, with one conditional review and driver notification', async () => {
  for (const [action, role] of [['approve', 'admin'], ['reject', 'supervisor']]) {
    const h = await harness();
    await h.call('requestDriverAllocationStop', { reason: 'Unsafe road conditions' });
    await assert.rejects(h.call('reviewDriverAllocationStopRequest', { action, reviewNotes: '' }, role), { statusCode: 400 });
    const result = await h.call('reviewDriverAllocationStopRequest', { action, reviewNotes: 'Contacted driver and reviewed road conditions' }, role);
    assert.equal(result.statusCode, 200);
    assert.equal(h.stored.status, action === 'approve' ? 'cancelled' : 'in_transit');
    assert.equal(h.stockStatus, action === 'approve' ? 'available' : 'in_transit');
    assert.equal(h.stored.stopRequest.status, action === 'approve' ? 'approved' : 'rejected');
    assert.equal(h.stored.stopRequest.reason, 'Unsafe road conditions');
    assert.equal(h.stored.stopRequest.reviewedBy, actor(role).id);
    const again = await h.call('reviewDriverAllocationStopRequest', { action, reviewNotes: 'Duplicate review must not apply again' }, role);
    assert.equal(again.statusCode, 409);
    assert.equal(h.notifications.filter(item => item.kind === 'stop-reviewed').length, 1);
  }
});

test('rejection before acceptance keeps the booking pending; only an approved review cancels it', async () => {
  for (const action of ['approve', 'reject']) {
    const h = await harness('pending');
    await assert.rejects(h.call('requestDriverAllocationRejection', { reason: 'abc' }), { statusCode: 400 });
    await h.call('requestDriverAllocationRejection', { reason: 'Unable to take the scheduled delivery' });
    assert.equal(h.stored.status, 'pending');
    assert.equal(h.stored.rejectionRequest.status, 'pending');
    assert.deepEqual(h.notifications.find(item => item.kind === 'approver-inbox').roles, ['admin', 'supervisor']);
    assert.equal((await h.call('acceptDriverAllocation', {})).statusCode, 409);
    assert.equal((await h.call('updateDriverAllocation', { status: 'in_transit' })).statusCode, 409);
    assert.equal(h.stored.status, 'pending');
    await h.call('reviewDriverAllocationRejection', { action, reviewNotes: 'Driver schedule reviewed by supervisor' }, 'supervisor');
    assert.equal(h.stored.status, action === 'approve' ? 'cancelled' : 'pending');
    assert.equal(h.stored.rejectionRequest.status, action === 'approve' ? 'approved' : 'rejected');
    assert.equal(h.notifications.filter(item => item.kind === 'driver-inbox').length, 1);
    assert.equal((await h.call('reviewDriverAllocationRejection', { action, reviewNotes: 'No duplicate review allowed' }, 'admin')).statusCode, 409);
    if (action === 'reject') {
      assert.equal((await h.call('acceptDriverAllocation', {})).statusCode, 200);
      assert.equal(h.stored.status, 'assigned');
    }
  }
});

test('stale lifecycle updates cannot erase a cancellation request or overwrite newer GPS', async () => {
  const h = await harness();
  h.interleave(() => {
    h.stored.stopRequest = { status: 'pending', reason: 'Request arrived during the update' };
    h.stored.currentLocation = { latitude: 14.57, longitude: 121.07 };
  });
  await h.call('updateDriverAllocation', { status: 'in_transit', routeProgress: 0.6 });
  assert.equal(h.stored.stopRequest.status, 'pending');
  assert.equal(h.stored.currentLocation.latitude, 14.57);
  assert.ok(!Object.hasOwn(h.writes[0].update.$set, 'stopRequest'));
  const race = await harness();
  race.interleave(() => { race.stored.stopRequest = { status: 'pending', reason: 'Pending review during completion' }; });
  assert.equal((await race.call('updateDriverAllocation', { status: 'completed' })).statusCode, 409);
  assert.equal(race.stored.status, 'in_transit');
});

test('a finished trip cannot be cancelled by an old pending stop review', async () => {
  const h = await harness();
  await h.call('requestDriverAllocationStop', { reason: 'Driver needs to stop this trip' });
  h.interleave(() => { h.stored.status = 'completed'; });
  const result = await h.call('reviewDriverAllocationStopRequest', { action: 'approve', reviewNotes: 'Trip state changed before approval' }, 'admin');
  assert.equal(result.statusCode, 409); assert.equal(h.stored.status, 'completed');
  assert.equal(h.notifications.filter(item => item.kind === 'stop-reviewed').length, 0);
});

test('a cancellation request notifies admin and supervisor inboxes with the driver reason and reviewable record', async () => {
  let delivered;
  const { notifyDriverStopTripRequested } = await fixture('services/notificationDispatchers.js', {
    UnitAgentAllocation: { findOne: async () => null },
    User: { find: () => ({ select: async () => [{ id: 'admin-1' }, { id: 'supervisor-1' }] }) },
    createNotificationsForUsers: async value => { delivered = value; return []; },
  }, ['notifyDriverStopTripRequested']);
  await notifyDriverStopTripRequested({ id: 'trip-1', status: 'in_transit', driverId: { id: 'driver-1', firstName: 'Fixture', lastName: 'Driver' }, vehicleId: { id: 'unit-1', unitName: 'Isuzu NMR' }, stopRequest: { status: 'pending', reason: 'Engine overheating' } });
  assert.ok(delivered.userIds.includes('admin-1') && delivered.userIds.includes('supervisor-1'));
  assert.equal(delivered.data.entityType, 'driver_allocation'); assert.equal(delivered.data.entityId, 'trip-1');
  assert.equal(delivered.data.stopRequestReason, 'Engine overheating');
});
