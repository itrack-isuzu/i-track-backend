import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Evaluate actual handlers with injected in-memory repositories. No DB or providers are used.
async function loadFixture(path, mocks, exports) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  source = source.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/g, '').replace(/export const /g, 'const ');
  return new Function(...Object.keys(mocks), `${source}\nreturn { ${exports.join(', ')} };`)(...Object.values(mocks));
}
const directAsync = (handler) => handler;

test('shared mobile audit preloads return empty data for ordinary roles and retain management events', async () => {
  let reads = 0;
  const repository = { find: () => { reads++; return { sort: async () => [{ id: 'fixture-event' }] }; } };
  const sendSuccess = (res, payload) => { res.payload = payload; };
  const auth = await loadFixture('../src/controllers/authController.js', {
    asyncHandler: directAsync, AuthEvent: repository, sendSuccess,
  }, ['listAuthEvents']);
  const users = await loadFixture('../src/controllers/usersController.js', {
    asyncHandler: directAsync, UserAuditEvent: repository, sendSuccess,
    isManagement: (req) => ['admin', 'supervisor'].includes(req.authUser?.role),
  }, ['listUserAuditEvents']);
  for (const role of ['manager', 'sales_agent', 'dispatcher', 'driver']) {
    for (const handler of [auth.listAuthEvents, users.listUserAuditEvents]) {
      const res = {};
      await handler({ authUser: { id: 'fixture-user', role } }, res);
      assert.deepEqual(res.payload.data, []);
    }
  }
  assert.equal(reads, 0, 'ordinary preloads do not read or disclose privileged audit events');
  for (const role of ['admin', 'supervisor']) {
    for (const handler of [auth.listAuthEvents, users.listUserAuditEvents]) {
      const res = {};
      await handler({ authUser: { id: 'fixture-user', role } }, res);
      assert.equal(res.payload.data[0].id, 'fixture-event');
    }
  }
  assert.equal(reads, 4);
});
const user = (role, id = 'self') => ({ id, role, firstName: 'Fixture', lastName: role, email: 'fixture@example.test' });
const runGuard = async (guard, req) => {
  let called = false, error;
  try { await guard(req, {}, (value) => { called = true; error = value; }); }
  catch (value) { error = value; }
  assert.ok(called || error, 'middleware must either continue or reject');
  return error;
};

async function accessFixture(overrides = {}) {
  const empty = { exists: async () => null, findOne: () => ({ sort: async () => null }), find: () => ({ select: async () => [] }) };
  return loadFixture('../src/middleware/operationAccess.js', {
    DriverAllocation: { ...empty }, UnitAgentAllocation: { ...empty }, Preparation: { ...empty }, TestDriveBooking: { ...empty },
    Vehicle: { findById: async () => ({ status: 'available' }) }, User: { ...empty }, asyncHandler: directAsync, ...overrides,
  }, ['requireRoles', 'MANAGEMENT_ROLES', 'WEB_OPERATION_ROLES', 'authenticatedId', 'entityId', 'isManagement', 'accessError', 'withAccessScope', 'resourceScope', 'requireScopedRecord', 'guardVehicleDeletion', 'guardVehicleStatusUpdate', 'ensureVehicleCanBeScheduled', 'assertWorkflowVehicleAccess', 'guardDriverAllocationCreate', 'guardDriverAllocationUpdate', 'guardDriverAllocationDeletion', 'guardShipmentVehicle', 'requireAssignedDriver']);
}

async function routeFixture(filename, access, controllerOverrides = {}) {
  let reached = false;
  const middleware = [], routes = [];
  const router = { use: (handler) => middleware.push(handler) };
  for (const method of ['get', 'post', 'patch', 'delete']) router[method] = (path, ...handlers) => routes.push({ method, path, handlers });
  let source = await readFile(new URL(`../src/routes/${filename}`, import.meta.url), 'utf8');
  const controllers = {};
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/controllers\/[^'"]+['"]/g)) {
    for (const name of match[1].split(',').map((value) => value.trim()).filter(Boolean)) controllers[name] = async (...args) => { reached = true; return controllerOverrides[name]?.(...args); };
  }
  source = source.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/g, '').replace('export default router;', 'return router;');
  const deps = { ...access, ...controllers, Router: () => router };
  new Function(...Object.keys(deps), source)(...Object.values(deps));
  return async (method, path, req) => {
    reached = false;
    const response = {};
    const route = routes.find((entry) => entry.method === method && entry.path === path);
    assert.ok(route, `${method} ${path} is registered`);
    for (const handler of [...middleware, ...route.handlers]) {
      let advanced = false, error;
      try { await handler(req, response, (value) => { advanced = true; error = value; }); } catch (value) { error = value; }
      if (error) return { error, reached };
      if (!advanced) break;
    }
    return { reached, payload: response.payload };
  };
}

test('actual route chains reject unauthorized maintenance/stock/account actions before controllers run', async () => {
  const access = await accessFixture();
  for (const [file, method, path, allowed] of [
    ['setupRoutes.js', 'post', '/seed', ['admin']],
    ['preparationsRoutes.js', 'post', '/retrain-eta', ['admin']],
    ['usersRoutes.js', 'post', '/', ['admin', 'supervisor']],
    ['usersRoutes.js', 'delete', '/:id', ['admin', 'supervisor']],
    ['vehiclesRoutes.js', 'delete', '/:id', ['admin', 'supervisor']],
  ]) {
    const route = await routeFixture(file, access);
    for (const role of ['admin', 'supervisor', 'manager', 'sales_agent', 'dispatcher', 'driver']) {
      const result = await route(method, path, { authUser: user(role), params: { id: 'fixture' }, body: {}, query: {} });
      assert.equal(result.reached, allowed.includes(role), `${file}: ${role}`);
      if (!allowed.includes(role)) assert.equal(result.error.statusCode, 403);
    }
  }
});

test('management and maintenance guards preserve six roles and deny ordinary accounts', async () => {
  const access = await accessFixture();
  for (const role of ['admin', 'supervisor', 'manager', 'sales_agent', 'dispatcher', 'driver']) {
    const req = { authUser: user(role) };
    assert.equal(Boolean(await runGuard(access.requireRoles(...access.MANAGEMENT_ROLES), req)), !['admin', 'supervisor'].includes(role));
    assert.equal(Boolean(await runGuard(access.requireRoles('admin'), req)), role !== 'admin');
  }
  assert.equal((await runGuard(access.requireRoles('admin'), {})).statusCode, 401);
});

test('server scopes replace spoofed identity filters and preserve aggregated list access', async () => {
  let lookup;
  const access = await accessFixture({
    UnitAgentAllocation: { find: (query) => { lookup = query; return { select: async () => [{ vehicleId: 'own-vehicle' }] }; } },
    DriverAllocation: { find: () => ({ select: async () => [{ vehicleId: 'trip-vehicle' }] }) },
  });
  const driver = { authUser: user('driver'), query: { driverId: 'other' } };
  assert.equal(await runGuard(access.resourceScope('driverAllocations'), driver), undefined);
  assert.deepEqual(access.withAccessScope(driver, driver.query), { $and: [{ driverId: 'other' }, { driverId: 'self' }] });
  const manager = { authUser: user('manager') };
  await runGuard(access.resourceScope('driverAllocations'), manager);
  assert.deepEqual(lookup, { managerId: 'self' });
  assert.deepEqual(manager.accessFilters, { $or: [{ managerId: 'self' }, { vehicleId: { $in: ['own-vehicle'] } }] });
  const sales = { authUser: user('sales_agent') };
  await runGuard(access.resourceScope('vehicles'), sales);
  assert.deepEqual(sales.accessFilters, { $or: [{ _id: { $in: ['own-vehicle'] } }, { _id: { $nin: ['own-vehicle'] }, status: { $in: ['available', 'in_stockyard'] } }] }, 'shared directory excludes vehicles assigned to other users');
  await runGuard(access.resourceScope('preparations'), driver);
  assert.deepEqual(driver.accessFilters, { _id: { $in: [] } }, 'unrelated preloads return an empty array scope');
  const dispatcher = { authUser: user('dispatcher') };
  await runGuard(access.resourceScope('preparations'), dispatcher);
  assert.deepEqual(dispatcher.accessFilters, { approvalStatus: 'approved', $or: [{ dispatcherId: 'self' }, { dispatcherId: null }] });
});

test('actual vehicle list route returns assigned/self and unassigned shared stock, excluding another agent stock', async () => {
  const records = [
    { _id: 'own', status: 'under_preparation' }, { _id: 'other', status: 'available' },
    { _id: 'shared', status: 'available' }, { _id: 'released', status: 'completed' },
  ];
  const matches = (record, query) => Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some((entry) => matches(record, entry));
    if (key === '$and') return value.every((entry) => matches(record, entry));
    if (typeof value === 'object' && value !== null) return value.$in ? value.$in.includes(record[key]) : value.$nin ? !value.$nin.includes(record[key]) : false;
    return record[key] === value;
  });
  const Vehicle = {
    find: (query) => ({ sort: async () => records.filter((record) => matches(record, query)) }),
    exists: async (query) => records.some((record) => matches(record, query)) ? { _id: 'visible-fixture' } : null,
  };
  const access = await accessFixture({
    Vehicle,
    UnitAgentAllocation: { find: (query) => ({ select: async () => query.salesAgentId ? [{ vehicleId: 'own' }] : [{ vehicleId: 'own' }, { vehicleId: 'other' }] }) },
  });
  const controllers = await loadFixture('../src/controllers/vehiclesController.js', {
    ...access, Vehicle, asyncHandler: directAsync, buildLiteralSearchPattern: () => null,
    sendSuccess: (res, payload) => { res.payload = payload; },
  }, ['listVehicles']);
  const route = await routeFixture('vehiclesRoutes.js', access, controllers);
  const result = await route('get', '/', { authUser: user('sales_agent'), query: {}, params: {}, body: {} });
  assert.equal(result.reached, true);
  assert.deepEqual(result.payload.data.map((record) => record._id), ['own', 'shared']);
  const req = { authUser: user('sales_agent') };
  await access.assertWorkflowVehicleAccess(req, 'own');
  await access.assertWorkflowVehicleAccess(req, 'shared');
  await assert.rejects(access.assertWorkflowVehicleAccess(req, 'other'), (error) => error.statusCode === 403);
});

test('record lookup uses the same server ownership scope and refuses another driver trip', async () => {
  let query;
  const access = await accessFixture({ DriverAllocation: { findOne: async (value) => { query = value; return null; } } });
  const req = { authUser: user('driver'), params: { id: 'other-trip' }, accessFilters: { driverId: 'self' } };
  assert.equal((await runGuard(access.requireScopedRecord('driverAllocations'), req)).statusCode, 404);
  assert.deepEqual(query, { $and: [{ _id: 'other-trip' }, { driverId: 'self' }] });
  req.accessRecord = { driverId: 'another-driver' };
  assert.equal((await runGuard(access.requireAssignedDriver, req)).statusCode, 403);
  req.accessRecord.driverId = 'self';
  assert.equal(await runGuard(access.requireAssignedDriver, req), undefined);
});

test('own driver accept/start/complete works; skipping, cancellation, reassignment and GPS bypass fail', async () => {
  const access = await accessFixture();
  const req = { authUser: user('driver'), accessRecord: { driverId: 'self', status: 'pending' }, body: { status: 'assigned' } };
  for (const [before, after] of [['pending', 'assigned'], ['assigned', 'in_transit'], ['in_transit', 'completed']]) {
    req.accessRecord.status = before; req.body = { status: after, routeProgress: after === 'completed' ? 1 : 0 };
    assert.equal(await runGuard(access.guardDriverAllocationUpdate, req), undefined);
  }
  req.accessRecord.status = 'pending'; req.body = { status: 'completed' };
  assert.equal((await runGuard(access.guardDriverAllocationUpdate, req)).statusCode, 409);
  req.accessRecord.status = 'in_transit'; req.body = { status: 'cancelled' };
  assert.equal((await runGuard(access.guardDriverAllocationUpdate, req)).statusCode, 403);
  for (const body of [{ driverId: 'other' }, { currentLocation: { latitude: 1, longitude: 1 } }, { stopRequest: { status: 'approved' } }, { endTime: new Date() }]) {
    req.body = body;
    assert.equal((await runGuard(access.guardDriverAllocationUpdate, req)).statusCode, 403);
  }
});

test('drivers cannot bypass pending cancellation/rejection and only admin/supervisor can review either request route', async () => {
  const access = await accessFixture({ DriverAllocation: { findOne: async () => ({ id: 'trip', driverId: 'self', status: 'in_transit' }) } });
  for (const field of ['stopRequest', 'rejectionRequest']) {
    const req = { authUser: user('driver'), accessRecord: { driverId: 'self', status: 'in_transit', [field]: { status: 'pending' } }, body: { status: 'completed' } };
    assert.equal((await runGuard(access.guardDriverAllocationUpdate, req)).statusCode, 409);
  }
  const route = await routeFixture('driverAllocationsRoutes.js', access);
  for (const path of ['/:id/stop-request', '/:id/rejection-request']) {
    for (const role of ['admin', 'supervisor', 'driver', 'manager', 'sales_agent', 'dispatcher']) {
      const result = await route('patch', path, { authUser: user(role), params: { id: 'trip' }, body: { action: 'approve', reviewNotes: 'Fixture review reason' } });
      assert.equal(result.reached, ['admin', 'supervisor'].includes(role), `${role}: ${path}`);
    }
  }
});

test('referenced stock cannot be deleted; unreferenced stock is deletable', async () => {
  for (const model of ['DriverAllocation', 'Preparation', 'TestDriveBooking', 'UnitAgentAllocation']) {
    const access = await accessFixture({ [model]: { exists: async ({ vehicleId }) => vehicleId === 'v1' ? { _id: 'history' } : null } });
    assert.equal((await runGuard(access.guardVehicleDeletion, { params: { id: 'v1' } })).statusCode, 409);
    assert.equal(await runGuard(access.guardVehicleDeletion, { params: { id: 'unused' } }), undefined);
  }
});

test('released stock cannot be made available or scheduled; active stock retains normal management', async () => {
  const access = await accessFixture({ Preparation: { findOne: () => ({ sort: async () => ({ status: 'completed' }) }) } });
  await assert.rejects(access.ensureVehicleCanBeScheduled('released'), (error) => error.statusCode === 409);
  assert.equal((await runGuard(access.guardVehicleStatusUpdate, { params: { id: 'released' }, body: { status: 'available' } })).statusCode, 409);
  assert.equal(await runGuard(access.guardVehicleStatusUpdate, { params: { id: 'released' }, body: { status: 'completed' } }), undefined);
  const available = await accessFixture();
  await available.ensureVehicleCanBeScheduled('available');
});

test('self profile cannot reset a password or elevate privileges; existing full profile saves and authorized resets work', async () => {
  const access = await accessFixture();
  const existing = { ...user('driver'), phone: '09123456789', isActive: true, managerId: null };
  let writes = 0, hashes = 0;
  const users = await loadFixture('../src/controllers/usersController.js', {
    ...access,
    User: {
      findById: () => Object.assign(Promise.resolve(existing), { populate: async () => existing }),
      findByIdAndUpdate: async (id, payload) => { writes++; Object.assign(existing, payload); return existing; },
    },
    UserAuditEvent: {}, asyncHandler: directAsync, sendSuccess: (res, payload) => { res.payload = payload; },
    ensureValidPhoneNumber: (phone) => phone, ensureUniquePhoneNumber: async () => {},
    hashPassword: async () => { hashes++; return 'fixture-hash'; },
  }, ['updateUser', 'buildUserFilters']);
  const req = { authUser: existing, params: { id: 'self' }, body: { password: 'unauthorized' } };
  await assert.rejects(users.updateUser(req, {}), (error) => error.statusCode === 403);
  for (const body of [{ role: 'admin' }, { isActive: false }, { managerId: 'other' }, { passwordHash: 'bypass' }]) {
    await assert.rejects(users.updateUser({ ...req, body }, {}), (error) => [400, 403].includes(error.statusCode));
  }
  await assert.rejects(users.updateUser({ ...req, params: { id: 'other' }, body: { firstName: 'changed' } }, {}), (error) => error.statusCode === 403);
  assert.equal(writes, 0); assert.equal(hashes, 0);
  await users.updateUser({ ...req, body: { firstName: 'Updated', role: 'driver', isActive: true, email: existing.email, phone: existing.phone } }, {});
  assert.equal(existing.firstName, 'Updated'); assert.equal(existing.role, 'driver');
  await users.updateUser({ ...req, authUser: user('supervisor', 'manager'), body: { password: 'authorized-temporary-fixture' } }, {});
  assert.equal(existing.passwordHash, 'fixture-hash'); assert.equal(existing.mustChangePassword, true);
  assert.equal(hashes, 1);
  const filters = users.buildUserFilters({ search: '[' });
  assert.equal(filters.$or[0].firstName.test('abc[def'), true);
});

test('preparation identity/approval come from session; assigned dispatcher checklist and admin release remain available', async () => {
  const access = await accessFixture();
  const prep = await loadFixture('../src/controllers/preparationsController.js', { ...access, asyncHandler: directAsync }, ['authorizePreparationPayload']);
  const req = { authUser: user('sales_agent'), body: { requestedByUserId: 'spoof', requestedByRole: 'admin', requestedByName: 'Spoof' } };
  const created = prep.authorizePreparationPayload(req);
  assert.equal(created.requestedByUserId, 'self'); assert.equal(created.requestedByRole, 'sales_agent'); assert.equal(created.status, 'pending');
  assert.throws(() => prep.authorizePreparationPayload({ ...req, body: { approvalStatus: 'approved' } }), (error) => error.statusCode === 403);
  const existing = { requestedByUserId: 'self', requestedByRole: 'sales_agent', requestedByName: 'Original', status: 'pending', approvalStatus: 'awaiting_approval', dispatcherChecklist: [{ id: '1', completed: false }] };
  const edited = prep.authorizePreparationPayload({ ...req, body: { dispatcherChecklist: [{ id: 'new-service', label: 'Actual changed service', completed: true, completedAt: new Date() }] } }, existing);
  assert.equal(edited.dispatcherChecklist[0].id, 'new-service');
  assert.equal(edited.dispatcherChecklist[0].completed, false);
  assert.equal(edited.dispatcherChecklist[0].completedAt, null);
  assert.throws(() => prep.authorizePreparationPayload({ ...req, body: { approvalStatus: 'approved' } }, existing), (error) => error.statusCode === 403);
  const approved = prep.authorizePreparationPayload({ authUser: user('supervisor'), body: { approvalStatus: 'approved', status: 'in_dispatch', approvedByName: 'Spoof' } }, existing);
  assert.equal(approved.approvedByName, 'Fixture supervisor'); assert.equal(approved.requestedByName, 'Original');
  const dispatchExisting = { ...existing, ...approved, status: 'in_dispatch' };
  const dispatcher = { authUser: user('dispatcher'), body: { status: 'ready_for_release', dispatcherChecklist: [{ id: '1', completed: true }] } };
  assert.equal(prep.authorizePreparationPayload(dispatcher, dispatchExisting).dispatcherId, 'self');
  assert.throws(() => prep.authorizePreparationPayload({ ...dispatcher, body: { status: 'completed' } }, dispatchExisting), (error) => [403, 409].includes(error.statusCode));
  assert.throws(() => prep.authorizePreparationPayload({ ...dispatcher, body: { status: 'ready_for_release', dispatcherChecklist: [] } }, dispatchExisting), (error) => error.statusCode === 403);
  assert.throws(() => prep.authorizePreparationPayload({ authUser: user('admin'), body: { status: 'completed', dispatcherChecklist: [{ id: '1', completed: true }] } }, dispatchExisting), (error) => error.statusCode === 409);
  const released = prep.authorizePreparationPayload({ authUser: user('admin'), body: { status: 'completed', dispatcherChecklist: [{ id: '1', completed: true }] } }, { ...dispatchExisting, status: 'ready_for_release' });
  assert.equal(released.status, 'completed'); assert.equal(released.progress, 100);
});

test('bookings preserve scoped team and own management while keeping approval privileged', async () => {
  const access = await accessFixture();
  const bookings = await loadFixture('../src/controllers/testDriveBookingsController.js', {
    ...access, asyncHandler: directAsync,
    User: { exists: async (query) => query._id === 'team-agent' && query.managerId === 'self' ? { _id: 'team-agent' } : null },
    UnitAgentAllocation: { exists: async () => null },
    normalizePhoneNumber: (value) => String(value).trim(),
  }, ['authorizeBookingPayload', 'assertBookingOwnership']);
  const req = { authUser: user('sales_agent'), body: { requestedByUserId: 'spoof' } };
  assert.equal((await bookings.authorizeBookingPayload(req)).requestedByUserId, 'self');
  await assert.rejects(bookings.authorizeBookingPayload({ ...req, body: { status: 'approved' } }), (error) => error.statusCode === 403);
  await assert.rejects(bookings.authorizeBookingPayload(req, { requestedByUserId: 'other', status: 'pending' }), (error) => error.statusCode === 403);
  assert.equal((await bookings.authorizeBookingPayload({ authUser: user('supervisor'), body: { status: 'approved' } }, { requestedByUserId: 'other', status: 'pending' })).requestedByUserId, 'other');
  const approved = { requestedByUserId: 'self', vehicleId: 'shared', status: 'approved', scheduledDate: '2026-10-18', customerName: 'Actual customer' };
  for (const status of ['completed', 'cancelled', 'no_show']) {
    assert.equal((await bookings.authorizeBookingPayload({ ...req, body: { status } }, approved)).status, status);
  }
  await assert.rejects(bookings.authorizeBookingPayload({ ...req, body: { status: 'cancelled' } }, { ...approved, status: 'pending' }), (error) => error.statusCode === 403);
  await assert.rejects(bookings.authorizeBookingPayload({ ...req, body: { status: 'completed', scheduledDate: '2026-10-20' } }, approved), (error) => error.statusCode === 403);
  assert.equal((await bookings.authorizeBookingPayload({ ...req, body: { status: 'completed', customerName: 'Actual customer', notes: 'Finished test drive' } }, approved)).status, 'completed');
  const team = { ...approved, requestedByUserId: 'team-agent' };
  const manager = { authUser: user('manager'), body: { status: 'completed' } };
  assert.equal((await bookings.authorizeBookingPayload(manager, team)).status, 'completed');
  assert.equal((await bookings.authorizeBookingPayload({ ...manager, body: { customerName: 'Revised customer' } }, { ...team, status: 'pending' })).customerName, 'Revised customer');
  await bookings.assertBookingOwnership(manager, team);
  await assert.rejects(bookings.authorizeBookingPayload(manager, { ...team, requestedByUserId: 'other-team-agent' }), (error) => error.statusCode === 403);
  await assert.rejects(bookings.assertBookingOwnership(req, team), (error) => error.statusCode === 403);
  await assert.rejects(bookings.authorizeBookingPayload({ ...manager, body: { status: 'approved' } }, { ...team, status: 'pending' }), (error) => error.statusCode === 403);
  const scope = await accessFixture({ User: { find: () => ({ select: async () => [{ _id: 'team-agent' }] }) } });
  const managerList = { authUser: user('manager') };
  await runGuard(scope.resourceScope('bookings'), managerList);
  assert.deepEqual(managerList.accessFilters.$or[0], { requestedByUserId: { $in: ['self', 'team-agent'] } });

  const stored = { id: 'booking', requestedByUserId: 'team-agent', vehicleId: 'shared', status: 'approved', customerName: 'Actual customer', customerPhone: '09123456789', scheduledDate: '2026-10-18', scheduledTime: '09:00 AM' };
  let writes = 0;
  const User = {
    find: () => ({ select: async () => [{ _id: 'team-agent' }] }),
    exists: async (query) => query._id === 'team-agent' && query.managerId === 'self' ? { _id: 'team-agent' } : null,
    findById: async () => ({ id: 'team-agent' }),
  };
  const UnitAgentAllocation = { find: () => ({ select: async () => [] }), exists: async () => null };
  const TestDriveBooking = {
    findOne: async (query) => query.$and?.[1]?.$or?.[0]?.requestedByUserId?.$in?.includes(stored.requestedByUserId) ? stored : null,
    findById: () => Object.assign(Promise.resolve(stored), { populate: async () => stored }),
    findByIdAndUpdate: async (id, payload) => { writes++; Object.assign(stored, payload); return stored; },
  };
  const Vehicle = { findById: async () => ({ id: 'shared', status: 'available' }) };
  const pipelineAccess = await accessFixture({ User, UnitAgentAllocation, TestDriveBooking, Vehicle });
  const controllers = await loadFixture('../src/controllers/testDriveBookingsController.js', {
    ...pipelineAccess, User, UnitAgentAllocation, TestDriveBooking, Vehicle, asyncHandler: directAsync,
    ensureValidPhoneNumber: (value) => value, ensureUniquePhoneNumber: async () => {},
    normalizePhoneNumber: (value) => String(value).trim(), notifyTestDriveUpdated: async () => [],
    sendSuccess: (res, payload) => { res.payload = payload; },
  }, ['updateTestDriveBooking']);
  const route = await routeFixture('testDriveBookingsRoutes.js', pipelineAccess, controllers);
  const request = { authUser: user('manager'), params: { id: stored.id }, query: {}, body: { status: 'completed' } };
  assert.equal((await route('patch', '/:id', request)).payload.data.status, 'completed');
  assert.equal(writes, 1);
  stored.status = 'approved';
  const unrelated = await route('patch', '/:id', { ...request, authUser: user('sales_agent'), body: { status: 'completed' } });
  assert.equal(unrelated.error.statusCode, 404);
  assert.equal(writes, 1);
  const own = await route('patch', '/:id', { ...request, authUser: user('sales_agent', 'team-agent'), body: { status: 'completed' } });
  assert.equal(own.payload.data.status, 'completed');
  assert.equal(writes, 2);
});

test('notification and token operations ignore no identity gaps and reject other-account ids', async () => {
  const access = await accessFixture();
  let query;
  const notifications = await loadFixture('../src/controllers/notificationsController.js', {
    ...access, asyncHandler: directAsync, sendSuccess: () => {},
    Notification: { find: (value) => { query = value; return { sort: async () => [] }; } },
  }, ['listNotifications', 'registerPushToken', 'unregisterPushToken', 'markAllNotificationsRead']);
  await notifications.listNotifications({ authUser: user('driver'), query: {} }, {});
  assert.deepEqual(query, { userId: 'self' });
  for (const handler of Object.values(notifications)) {
    await assert.rejects(handler({ authUser: user('driver'), query: { userId: 'other' }, body: { userId: 'other' } }, {}), (error) => error.statusCode === 403);
  }
});
