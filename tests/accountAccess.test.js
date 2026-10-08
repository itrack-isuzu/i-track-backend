import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function loadWithMocks(path, mocks) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  source = source.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/g, '');
  const names = Object.keys(mocks);
  return new Function(...names, source.replace(/export const /g, 'const ') + '\nreturn { notifyDriverGpsConnectionLost: typeof notifyDriverGpsConnectionLost === "undefined" ? null : notifyDriverGpsConnectionLost, accountAccess: typeof accountAccess === "undefined" ? null : accountAccess, scanDriverSafetyAlerts: typeof scanDriverSafetyAlerts === "undefined" ? null : scanDriverSafetyAlerts };')(...Object.values(mocks));
}

test('API blocks restricted accounts, allows password change, and rejects invalid sessions', async () => {
  let user = { id: 'u1', isActive: true, mustChangePassword: true };
  const { accountAccess } = await loadWithMocks('../src/middleware/accountAccess.js', {
    AuthSession: { findOne: () => ({ populate: async () => user ? { userId: user } : null }) },
    asyncHandler: fn => fn,
  });
  async function request(path, token = 'Bearer valid') {
    let status, payload, allowed = false;
    const req = { path, get: () => token };
    const res = { status: value => { status = value; return res; }, json: value => { payload = value; } };
    await accountAccess(req, res, () => { allowed = true; });
    return { status, payload, allowed };
  }
  assert.equal((await request('/vehicles')).payload.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await request('/auth/change-password')).allowed, true);
  assert.equal((await request('/auth/me')).allowed, true);
  assert.equal((await request('/auth/login', null)).allowed, true);
  assert.equal((await request('/vehicles', null)).status, 401);
  user.mustChangePassword = false;
  assert.equal((await request('/vehicles')).allowed, true);
  user.isActive = false;
  assert.equal((await request('/vehicles')).status, 401);
});

test('GPS outage alerts once, rearms on recovery, and ignores completed trips', async () => {
  const now = new Date('2026-10-06T12:00:00Z');
  const allocation = { id: 'trip', status: 'in_transit', currentLocation: { updatedAt: new Date(now - 301000) }, aiState: {} };
  let alerts = 0;
  const { scanDriverSafetyAlerts } = await loadWithMocks('../src/services/driverSafetyMonitorService.js', {
    DRIVER_AI_THRESHOLDS: { safetyMonitor: { gpsLostAfterSeconds: 300, gpsMissingAfterTripStartSeconds: 120, alertCooldownSeconds: 900 } },
    DriverAllocation: {
      find: () => ({ populate: async () => [allocation] }),
      findByIdAndUpdate: async (id, update) => { for (const [key, value] of Object.entries(update.$set)) allocation.aiState[key.split('.')[1]] = value; },
    },
    notifyDriverGpsConnectionLost: async () => { alerts++; },
    notifyDriverEtaOverdue: async () => {}, notifyDriverShipmentStartOverdue: async () => {},
  });
  await scanDriverSafetyAlerts(now);
  await scanDriverSafetyAlerts(new Date(+now + 1000000));
  assert.equal(alerts, 1);
  allocation.currentLocation.updatedAt = now;
  await scanDriverSafetyAlerts(now);
  await scanDriverSafetyAlerts(new Date(+now + 301000));
  assert.equal(alerts, 2);
  allocation.status = 'completed';
  allocation.aiState.lastGpsLostNotifiedAt = null;
  await scanDriverSafetyAlerts(new Date(+now + 1000000));
  assert.equal(alerts, 2);
});


test('connection alerts reach tracking roles and vehicle owners without duplicate recipients', async () => {
  let sent;
  const { notifyDriverGpsConnectionLost } = await loadWithMocks('../src/services/notificationDispatchers.js', {
    UnitAgentAllocation: { findOne: async () => ({ managerId: 'manager', salesAgentId: 'agent' }) },
    User: { find: () => ({ select: async () => [{ id: 'admin' }, { id: 'supervisor' }] }) },
    createNotificationsForUsers: async payload => { sent = payload; return []; },
    createNotificationsForRoles: async () => [],
  });
  await notifyDriverGpsConnectionLost({ id: 'trip', status: 'in_transit', managerId: 'manager', vehicleId: 'vehicle' }, { staleSeconds: 300 });
  assert.deepEqual(sent.userIds, ['admin', 'supervisor', 'manager', 'agent']);
  assert.equal(sent.data.safetyAlertType, 'gps_connection_lost');
  assert.equal(sent.type, 'alert');
});
