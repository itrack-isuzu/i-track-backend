import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildLiteralSearchPattern,
  parseCoordinates,
  parseFiniteNumber,
  validateEnumInput,
  validateVehiclePayload,
} from '../src/utils/inputValidation.js';

async function loadWithMocks(path, mocks, exports) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  source = source.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*/g, '');
  return new Function(...Object.keys(mocks),
    source.replace(/export const /g, 'const ') + `\nreturn { ${exports.join(', ')} };`
  )(...Object.values(mocks));
}

const invalid = (fn) => assert.throws(fn, (error) => error.statusCode === 400);
const statuses = ['available', 'in_stockyard', 'in_transit', 'under_preparation', 'completed', 'maintenance'];
const vehicleInput = {
  unitName: ' D-MAX ', variation: '3.0 4x4 AT', conductionNumber: 'ab12345', bodyColor: 'Splash White',
};

test('vehicle searches treat regex characters literally and reject oversized/structured queries', () => {
  for (const value of ['[', '(a+)+$', '.*', '\\', 'D-MAX (4x4)']) {
    const pattern = buildLiteralSearchPattern(value);
    assert.ok(pattern.test(`Unit ${value} example`));
    if (value !== 'D-MAX (4x4)') assert.equal(pattern.test('ordinary unit name'), false);
  }
  assert.equal(buildLiteralSearchPattern('   '), null);
  invalid(() => buildLiteralSearchPattern({ $ne: '' }));
  invalid(() => buildLiteralSearchPattern(['a', 'b']));
  invalid(() => buildLiteralSearchPattern('x'.repeat(201)));
});

test('numeric inputs reject blanks, booleans and nonfinite values while retaining genuine zero', () => {
  for (const value of ['', '  ', null, undefined, [], {}, true, false, Infinity, 'NaN']) {
    invalid(() => parseFiniteNumber(value, 'Latitude'));
  }
  assert.equal(parseFiniteNumber('0', 'Latitude'), 0);
  assert.deepEqual(parseCoordinates({ latitude: '14.58', longitude: '121.06' }), { latitude: 14.58, longitude: 121.06 });
  invalid(() => parseCoordinates({ latitude: 91, longitude: 0 }));
  invalid(() => parseCoordinates({ latitude: 0, longitude: -181 }));
});

test('vehicle POST/PATCH validate supplied fields consistently and preserve unchanged legacy identifiers', () => {
  const created = validateVehiclePayload(vehicleInput, { statuses });
  assert.equal(created.unitName, 'D-MAX');
  assert.equal(created.conductionNumber, 'AB12345');
  assert.deepEqual(validateVehiclePayload({ conductionNumber: ' ab12345 ' }, { partial: true, statuses }), { conductionNumber: 'AB12345' });
  assert.deepEqual(validateVehiclePayload({ conductionNumber: 'OLD-1234', notes: ' revised ' }, {
    partial: true, statuses, existingConductionNumber: 'OLD-1234',
  }), { notes: 'revised' });
  assert.deepEqual(validateVehiclePayload({ notes: ' revised ' }, { partial: true, statuses }), { notes: 'revised' });
  for (const conductionNumber of ['A', 'ABC123456', 'ABC-123', 'ABC 123']) {
    invalid(() => validateVehiclePayload({ ...vehicleInput, conductionNumber }, { statuses }));
  }
  invalid(() => validateVehiclePayload({ ...vehicleInput, unitName: ' ' }, { statuses }));
  invalid(() => validateVehiclePayload({ status: { $ne: 'completed' } }, { partial: true, statuses }));
  invalid(() => validateVehiclePayload({ $set: { status: 'available' } }, { partial: true, statuses }));
  invalid(() => validateVehiclePayload({ location: { latitude: '', longitude: '' } }, { partial: true, statuses }));
});

test('vehicle controller searches literal input and blocks invalid payload before persistence', async () => {
  let filter, update;
  const current = { id: 'v1', conductionNumber: 'LEGACY-ID' };
  const { listVehicles, createVehicle, updateVehicle } = await loadWithMocks('../src/controllers/vehiclesController.js', {
    Vehicle: {
      find: (value) => { filter = value; return { sort: async () => [] }; },
      create: () => { throw new Error('Invalid input must not persist.'); },
      findById: async () => current,
      findByIdAndUpdate: async (id, payload) => { update = payload; return current; },
    },
    VEHICLE_STATUSES: statuses, buildLiteralSearchPattern, validateEnumInput, validateVehiclePayload,
    asyncHandler: (fn) => fn, sendSuccess: () => {}, withAccessScope: (req, query) => query,
  }, ['listVehicles', 'createVehicle', 'updateVehicle']);
  await listVehicles({ query: { search: '[' } }, {});
  assert.ok(filter.$or[0].unitName.test('literal [ bracket'));
  await assert.rejects(createVehicle({ body: { ...vehicleInput, conductionNumber: 'too-long-identifier' } }, {}), { statusCode: 400 });
  await updateVehicle({ params: { id: 'v1' }, body: { conductionNumber: 'LEGACY-ID', notes: 'updated' } }, {});
  assert.deepEqual(update, { notes: 'updated' });
});

test('live-location controller rejects blank GPS before analysis and keeps existing speed units', async () => {
  let analyzed;
  const saved = { toJSON: () => ({ id: 'a1' }) };
  const { updateDriverAllocationLiveLocation } = await loadWithMocks('../src/controllers/driverAllocationsController.js', {
    DriverAllocation: {
      findById: () => ({ status: 'in_transit', populate: async () => saved }),
      findByIdAndUpdate: async () => {},
    },
    DRIVER_AI_THRESHOLDS: { gps: { maxClientTimestampSkewSeconds: 60, maxClientLocationAgeSeconds: 300, maxAcceptedAccuracyForStorageMeters: 1000 } },
    parseFiniteNumber, parseCoordinates,
    asyncHandler: (fn) => fn, sendSuccess: () => {},
    analyzeDriverBehavior: async ({ incomingLocation }) => {
      analyzed = incomingLocation;
      return { acceptedPoint: false, aiState: {} };
    },
    isDriverInTransitHeartbeatDue: () => false,
  }, ['updateDriverAllocationLiveLocation']);
  await assert.rejects(updateDriverAllocationLiveLocation({ params: { id: 'a1' }, body: { latitude: '', longitude: ' ' } }, {}), { statusCode: 400 });
  assert.equal(analyzed, undefined);
  await updateDriverAllocationLiveLocation({ params: { id: 'a1' }, body: { latitude: 14.5, longitude: 121, speed: 10 } }, {});
  assert.equal(analyzed.speed, 10);
  assert.equal(analyzed.accuracy, null);
});

test('allocation validation retains scheduled shipment dates and reconciliation preserves stock lifecycle', async () => {
  let active = null;
  let preparation = { status: 'ready_for_release' };
  let status = 'under_preparation';
  const { prepareAllocationPayload, reconcileVehicleStatus } = await loadWithMocks('../src/controllers/driverAllocationsController.js', {
    ACTIVE_ALLOCATION_STATUSES: ['pending', 'assigned', 'in_transit'],
    DriverAllocation: { findOne: () => ({ sort: async () => active }) },
    Preparation: { findOne: () => ({ sort: async () => preparation }) },
    Vehicle: {
      findById: async () => ({ id: 'v1', status }),
      findByIdAndUpdate: async (id, payload) => { status = payload.status; },
    },
    User: { findById: async () => ({ id: 'd1', role: 'driver' }) },
    parseFiniteNumber, parseCoordinates, asyncHandler: (fn) => fn,
  }, ['prepareAllocationPayload', 'reconcileVehicleStatus']);
  const input = {
    vehicleId: 'v1', driverId: 'd1', status: 'cancelled', scheduledShipmentAt: '2026-10-20T01:30:00.000Z',
    pickupLocation: { name: 'Origin', address: 'A', latitude: '14.5', longitude: '121' },
    destinationLocation: { name: 'Destination', address: 'B', latitude: 14.6, longitude: 121.1 },
  };
  const payload = await prepareAllocationPayload(input);
  assert.equal(payload.scheduledShipmentAt.toISOString(), input.scheduledShipmentAt);
  assert.equal(payload.pickupLocation.latitude, 14.5);
  await assert.rejects(prepareAllocationPayload({ ...input, pickupLocation: { ...input.pickupLocation, latitude: '' } }), { statusCode: 400 });
  await reconcileVehicleStatus('v1');
  assert.equal(status, 'under_preparation');
  preparation = { status: 'completed' };
  await reconcileVehicleStatus('v1');
  assert.equal(status, 'completed');
  preparation = null;
  await reconcileVehicleStatus('v1');
  assert.equal(status, 'completed');
  status = 'maintenance';
  await reconcileVehicleStatus('v1');
  assert.equal(status, 'maintenance');
  active = { status: 'in_transit' };
  await reconcileVehicleStatus('v1');
  assert.equal(status, 'in_transit');
});

test('SMS provider HTTP-success failures reject while established FMCSMS success codes stay accepted', async () => {
  const env = { smsEnabled: true, smsProvider: 'unisms', unismsApiUrl: 'https://fixture.invalid', unismsApiSecretKey: 'fixture' };
  let body = { success: false, message: 'Rejected by provider' };
  let requests = 0;
  const { sendPreparationCompletionSms } = await loadWithMocks('../src/services/smsService.js', {
    env,
    fetch: async () => {
      requests++;
      return { ok: true, status: 200, text: async () => typeof body === 'string' ? body : JSON.stringify(body) };
    },
    console: { log() {}, warn() {}, error() {} },
  }, ['sendPreparationCompletionSms']);
  const input = { customerName: 'Fixture', phoneNumber: '09123456789', vehicleLabel: 'D-MAX' };
  await assert.rejects(sendPreparationCompletionSms(input), /Rejected by provider/);
  env.smsProvider = 'fortmed'; env.fortmedApiUrl = 'https://fixture.invalid'; env.fortmedApiKey = 'fixture';
  body = 'Message was not sent';
  await assert.rejects(sendPreparationCompletionSms(input), /not sent/);
  body = { success: false, status: 'success' };
  await assert.rejects(sendPreparationCompletionSms(input));
  env.smsProvider = 'fmcsms'; env.fmcsmsApiUrl = 'https://fixture.invalid'; env.fmcsmsUsername = 'fixture'; env.fmcsmsPassword = 'fixture'; env.fmcsmsSenderId = 'fixture';
  for (const code of ['1701', '1111', '1112', '1113:queued']) {
    body = code;
    assert.equal((await sendPreparationCompletionSms(input)).skipped, false);
  }
  body = '1702';
  await assert.rejects(sendPreparationCompletionSms(input), /1702/);
  assert.equal(requests, 8);
});

test('ETA responses pair freshly calculated values with fallback/model provenance without writes or training', async () => {
  const env = { preparationEtaAiEnabled: false };
  let artifact;
  const service = await loadWithMocks('../src/services/preparationEtaService.js', {
    env,
    PreparationEtaArtifact: { findOne: () => ({ lean: async () => artifact }) },
    Preparation: new Proxy({}, { get() { throw new Error('ETA response must not query, write or train preparation records.'); } }),
    console: { log() {}, warn() {} },
  }, ['buildPreparationEtaResponse', 'initializePreparationEtaModel', 'getFeatureNames']);
  const original = { id: 'p1', status: 'pending', requestedServices: ['carwash'], predictedTotalMinutes: 999 };
  const fallback = await service.buildPreparationEtaResponse(original);
  assert.equal(fallback.predictionSource, 'fallback');
  assert.equal(fallback.predictionFallbackReason, 'model_disabled');
  assert.equal(fallback.predictedTotalMinutes, 30);
  assert.equal(original.predictedTotalMinutes, 999);
  env.preparationEtaAiEnabled = true;
  const featureCount = service.getFeatureNames().length;
  artifact = { key: 'fixture', modelBundle: {
    format: 'itrack.preparation_eta.linear_regression.v1',
    payload: { weights: Array(featureCount).fill(0), bias: 25, normalization: { count: 6, means: Array(featureCount).fill(0), scales: Array(featureCount).fill(1) } },
    metadata: { trainedRecords: 6, modelType: 'linear_regression' },
  } };
  await service.initializePreparationEtaModel();
  const learned = await service.buildPreparationEtaResponse(original);
  assert.equal(learned.predictionSource, 'model');
  assert.equal(learned.predictionFallbackReason, null);
  assert.equal(learned.predictedTotalMinutes, 25);
  assert.equal(original.predictedTotalMinutes, 999);
});
