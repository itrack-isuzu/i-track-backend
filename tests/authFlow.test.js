import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Run the real controller with an in-memory database and password verifier.
// These values represent injected test fixtures, never production credentials.
const source = (await readFile(new URL('../src/controllers/authController.js', import.meta.url), 'utf8'))
  .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/g, '').replace(/export const /g, 'const ');
function fixture(role, mustChangePassword = false) {
  const user = { id: 'fixture-user', email: 'fixture@example.test', role, isActive: true, mustChangePassword, passwordHash: 'old-hash', save: async () => {} };
  let storedSession;
  const deps = {
    randomUUID: () => 'fixture-session-token',
    User: { findOne: () => ({ select: async () => user }), findById: () => Object.assign(Promise.resolve(user), { populate: async () => user, select: async () => user }) },
    AuthSession: { create: async record => { storedSession = record; }, deleteOne: async ({ token }) => { if (storedSession?.token === token) storedSession = null; } },
    AuthEvent: { create: async () => {} }, asyncHandler: fn => fn,
    sendSuccess: (res, payload) => { res.payload = payload; },
    verifyPassword: async (password, hash) => password === (hash === 'old-hash' ? 'fixture-old' : 'fixture-new'),
    hashPassword: async () => 'new-hash', env: {},
  };
  const controller = new Function(...Object.keys(deps), source + '; return { login, logout, changePassword };')(...Object.values(deps));
  return { user, controller, getSession: () => storedSession };
}

for (const role of ['admin', 'supervisor', 'manager', 'sales_agent', 'dispatcher', 'driver']) {
  test(`${role}: existing login, persistent token and logout`, async () => {
    const f = fixture(role); const res = {};
    await f.controller.login({ body: { email: f.user.email, password: 'fixture-old' } }, res);
    assert.equal(res.payload.data.user.role, role);
    assert.equal(res.payload.data.user.mustChangePassword, false);
    assert.equal(f.getSession().token, res.payload.data.token);
    // Reads across requests return the same stored session, rather than an untracked UUID.
    assert.equal(f.getSession().userId, f.user.id);
    await f.controller.logout({ body: {}, authUser: f.user, authToken: f.getSession().token }, {});
    assert.equal(f.getSession(), null);
  });
}

test('invalid credentials and inactive users cannot create sessions', async () => {
  const f = fixture('admin');
  await assert.rejects(f.controller.login({ body: { password: 'incorrect-fixture' } }, {}), error => error.statusCode === 401);
  assert.equal(f.getSession(), undefined);
  f.user.isActive = false;
  await assert.rejects(f.controller.login({ body: { password: 'fixture-old' } }, {}), error => error.statusCode === 403);
});

test('first-login password change authenticates, rejects reuse and unauthorized changes, then clears the flag', async () => {
  const f = fixture('sales_agent', true); const res = {};
  await f.controller.login({ body: { password: 'fixture-old' } }, res);
  assert.equal(res.payload.data.user.mustChangePassword, true);
  const req = { authUser: f.user, body: { userId: f.user.id, currentPassword: 'fixture-old', nextPassword: 'fixture-new' } };
  await assert.rejects(f.controller.changePassword({ ...req, body: { ...req.body, userId: 'another-user' } }, {}), error => error.statusCode === 403);
  await assert.rejects(f.controller.changePassword({ ...req, body: { ...req.body, nextPassword: 'fixture-old' } }, {}), /different/);
  assert.equal(f.user.mustChangePassword, true);
  await f.controller.changePassword(req, {});
  assert.equal(f.user.mustChangePassword, false);
  assert.equal(f.user.passwordHash, 'new-hash');
  assert.ok(f.getSession());
});
