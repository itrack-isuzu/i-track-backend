import { PreparationEtaArtifact } from '../models/PreparationEtaArtifact.js';
import { Preparation } from '../models/Preparation.js';
import { env } from '../config/env.js';

const serviceTypes = [
  'detailing',
  'carwash',
  'tinting',
  'ceramic_coating',
  'accessories',
  'rust_proof',
  'inspection',
  'maintenance',
  'painting',
];

const PREPARATION_ETA_ARTIFACT_KEY = 'preparation_eta_default';
const PREPARATION_ETA_MODEL_FORMAT = 'itrack.preparation_eta.linear_regression.v1';
const PREPARATION_ETA_MODEL_VERSION = 1;
const MINIMUM_TRAINING_ROWS = 5;
const TRAINING_EPOCHS = 800;
const LEARNING_RATE = 0.03;
const RIDGE_LAMBDA = 0.001;

const MODEL_STATE = {
  model: null,
  metadata: {},
  loadedFrom: 'fallback',
  availability: 'fallback',
  artifactSummary: null,
};

const getRequestedServiceCount = (payload) =>
  (Array.isArray(payload?.requestedServices) ? payload.requestedServices.length : 0) +
  Math.max(Number(payload?.customRequestsCount ?? 0), 0);

const getMaxAllowedTotalMinutes = (payload) => Math.max(getRequestedServiceCount(payload), 1) * 60;

const toDate = (value) => {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const roundMinutes = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return Math.round(numeric);
};

const getElapsedMinutes = (startValue) => {
  const start = toDate(startValue);

  if (!start) {
    return 0;
  }

  const elapsedMs = Date.now() - start.getTime();
  return elapsedMs > 0 ? Math.round(elapsedMs / 60000) : 0;
};

const buildRequestedServiceSet = (preparation) =>
  new Set((preparation?.requestedServices ?? []).map((value) => String(value ?? '').trim()));

const buildChecklist = (preparation) =>
  Array.isArray(preparation?.dispatcherChecklist)
    ? preparation.dispatcherChecklist.map((item) => ({
        id: String(item?.id ?? '').trim(),
        label: String(item?.label ?? '').trim(),
        completed: item?.completed === true,
        completedAt: toDate(item?.completedAt)?.toISOString() ?? null,
      }))
    : [];

export const getFeatureNames = () => [
  ...serviceTypes.map((serviceType) => `service_${serviceType}`),
  'customRequestsCount',
  'totalChecklistItems',
  'completedChecklistItems',
  'detailingRequested',
  'detailingCompleted',
  'elapsedMinutesSinceInDispatch',
  'dispatchStartHour',
  'dispatchStartDayOfWeek',
];

export const buildPredictionPayload = (preparation) => {
  const requestedServices = buildRequestedServiceSet(preparation);
  const checklist = buildChecklist(preparation);
  const completedChecklistItems = checklist.filter((item) => item.completed);
  const detailingChecklistItem = checklist.find(
    (item) => item.id === 'detailing' || item.label.toLowerCase() === 'detailing'
  );
  const inDispatchAt = toDate(preparation?.inDispatchAt);
  const readyForReleaseAt = toDate(preparation?.readyForReleaseAt);

  return {
    preparationId: String(preparation?.id ?? preparation?._id ?? ''),
    status: String(preparation?.status ?? ''),
    requestedServices: [...requestedServices],
    customRequestsCount: Array.isArray(preparation?.customRequests)
      ? preparation.customRequests.filter(Boolean).length
      : 0,
    totalChecklistItems: checklist.length,
    completedChecklistItems: completedChecklistItems.length,
    detailingRequested: requestedServices.has('detailing'),
    detailingCompleted:
      detailingChecklistItem?.completed === true ||
      completedChecklistItems.some((item) => item.label.toLowerCase() === 'detailing'),
    elapsedMinutesSinceInDispatch: getElapsedMinutes(inDispatchAt),
    dispatchStartHour: inDispatchAt ? inDispatchAt.getHours() : null,
    dispatchStartDayOfWeek: inDispatchAt ? inDispatchAt.getDay() : null,
    inDispatchAt: inDispatchAt?.toISOString() ?? null,
    readyForReleaseAt: readyForReleaseAt?.toISOString() ?? null,
    serviceFlags: Object.fromEntries(
      serviceTypes.map((serviceType) => [serviceType, requestedServices.has(serviceType)])
    ),
  };
};

export const applyPredictionSnapshot = (preparation, prediction) => {
  const predictedTotalMinutes = roundMinutes(prediction?.predictedTotalMinutes);
  const predictedRemainingMinutes = roundMinutes(prediction?.predictedRemainingMinutes);

  return {
    ...preparation,
    predictedTotalMinutes,
    predictedRemainingMinutes,
    predictionGeneratedAt: new Date(),
  };
};

const clampPredictionToServiceCap = (payload, prediction) => {
  const maxAllowedTotalMinutes = getMaxAllowedTotalMinutes(payload);
  const predictedTotalMinutes = Math.min(
    roundMinutes(prediction?.predictedTotalMinutes) ?? maxAllowedTotalMinutes,
    maxAllowedTotalMinutes
  );
  const predictedRemainingMinutes = Math.min(
    roundMinutes(prediction?.predictedRemainingMinutes) ?? predictedTotalMinutes,
    predictedTotalMinutes
  );

  return {
    ...prediction,
    predictedTotalMinutes,
    predictedRemainingMinutes,
    maxAllowedTotalMinutes,
  };
};

const toFeatureVector = (payload) => [
  ...serviceTypes.map((serviceType) => (payload.serviceFlags?.[serviceType] ? 1 : 0)),
  Number(payload.customRequestsCount ?? 0),
  Number(payload.totalChecklistItems ?? 0),
  Number(payload.completedChecklistItems ?? 0),
  payload.detailingRequested ? 1 : 0,
  payload.detailingCompleted ? 1 : 0,
  Math.max(Number(payload.elapsedMinutesSinceInDispatch ?? 0), 0),
  payload.dispatchStartHour ?? -1,
  payload.dispatchStartDayOfWeek ?? -1,
];

const buildFallbackPrediction = (payload) => {
  const serviceWeights = {
    carwash: 30,
    inspection: 30,
    accessories: 30,
    detailing: 45,
    maintenance: 45,
    rust_proof: 45,
    tinting: 45,
    ceramic_coating: 60,
    painting: 60,
  };

  let predictedTotalMinutes = 0;

  for (const [serviceType, enabled] of Object.entries(payload.serviceFlags ?? {})) {
    if (enabled) {
      predictedTotalMinutes += serviceWeights[serviceType] ?? 30;
    }
  }

  predictedTotalMinutes += (payload.customRequestsCount ?? 0) * 45;

  const remainingFromProgress =
    payload.totalChecklistItems > 0
      ? predictedTotalMinutes *
        (1 - payload.completedChecklistItems / payload.totalChecklistItems)
      : predictedTotalMinutes;

  const predictedRemainingMinutes = Math.max(
    Math.round(remainingFromProgress - (payload.elapsedMinutesSinceInDispatch ?? 0)),
    0
  );

  return clampPredictionToServiceCap(payload, {
    predictedTotalMinutes: Math.round(predictedTotalMinutes),
    predictedRemainingMinutes,
    source: 'fallback',
    fallbackReason: 'model_not_ready',
  });
};

const summarizeArtifact = (artifact) => {
  if (!artifact) {
    return null;
  }

  const bundle = artifact.modelBundle ?? {};
  const metadata = bundle.metadata ?? {};
  const hasLegacyBlob = Boolean(bundle.blobBase64);
  const isNodeNative = bundle.format === PREPARATION_ETA_MODEL_FORMAT && bundle.payload;

  return {
    key: artifact.key,
    source: artifact.source ?? 'model',
    trainedRecords: Math.max(Number(artifact.trainedRecords ?? 0), 0),
    updatedAt: artifact.updatedAt ?? null,
    modelBundle: isNodeNative
      ? {
          format: bundle.format,
          metadata,
        }
      : hasLegacyBlob
        ? {
            format: 'python.joblib.legacy',
            metadata,
          }
        : null,
    modelAvailability: isNodeNative ? 'model' : hasLegacyBlob ? 'legacy_unusable' : 'fallback',
  };
};

const setModelState = ({ model, metadata, loadedFrom, availability, artifactSummary }) => {
  MODEL_STATE.model = model ?? null;
  MODEL_STATE.metadata = metadata ?? {};
  MODEL_STATE.loadedFrom = loadedFrom ?? 'fallback';
  MODEL_STATE.availability = availability ?? 'fallback';
  MODEL_STATE.artifactSummary = artifactSummary ?? null;
};

const resetModelStateToFallback = (artifactSummary = null) => {
  setModelState({
    model: null,
    metadata: {},
    loadedFrom: 'fallback',
    availability: artifactSummary?.modelAvailability ?? 'fallback',
    artifactSummary,
  });
};

const createEmptyStats = () => ({
  count: 0,
  means: [],
  scales: [],
});

const fitLinearRegressionModel = (xTrain, yTrain) => {
  if (xTrain.length === 0) {
    return null;
  }

  const featureCount = xTrain[0].length;
  const stats = createEmptyStats();
  stats.count = xTrain.length;
  stats.means = new Array(featureCount).fill(0);
  stats.scales = new Array(featureCount).fill(1);

  for (const row of xTrain) {
    for (let index = 0; index < featureCount; index += 1) {
      stats.means[index] += row[index];
    }
  }

  for (let index = 0; index < featureCount; index += 1) {
    stats.means[index] /= xTrain.length;
  }

  for (const row of xTrain) {
    for (let index = 0; index < featureCount; index += 1) {
      const centered = row[index] - stats.means[index];
      stats.scales[index] += centered * centered;
    }
  }

  for (let index = 0; index < featureCount; index += 1) {
    const scale = Math.sqrt(stats.scales[index] / xTrain.length);
    stats.scales[index] = scale > 0 ? scale : 1;
  }

  const normalized = xTrain.map((row) =>
    row.map((value, index) => (value - stats.means[index]) / stats.scales[index])
  );
  const weights = new Array(featureCount).fill(0);
  let bias = yTrain.reduce((sum, value) => sum + value, 0) / yTrain.length;

  for (let epoch = 0; epoch < TRAINING_EPOCHS; epoch += 1) {
    const weightGradients = new Array(featureCount).fill(0);
    let biasGradient = 0;

    for (let rowIndex = 0; rowIndex < normalized.length; rowIndex += 1) {
      const row = normalized[rowIndex];
      let prediction = bias;

      for (let index = 0; index < featureCount; index += 1) {
        prediction += row[index] * weights[index];
      }

      const error = prediction - yTrain[rowIndex];
      biasGradient += error;

      for (let index = 0; index < featureCount; index += 1) {
        weightGradients[index] += error * row[index];
      }
    }

    const scale = 2 / normalized.length;
    bias -= LEARNING_RATE * scale * biasGradient;

    for (let index = 0; index < featureCount; index += 1) {
      const ridgePenalty = RIDGE_LAMBDA * weights[index];
      weights[index] -= LEARNING_RATE * (scale * weightGradients[index] + ridgePenalty);
    }
  }

  return {
    weights,
    bias,
    normalization: stats,
  };
};

const predictWithModel = (model, features) => {
  const normalized = features.map(
    (value, index) => (value - model.normalization.means[index]) / model.normalization.scales[index]
  );

  let prediction = model.bias;

  for (let index = 0; index < normalized.length; index += 1) {
    prediction += normalized[index] * model.weights[index];
  }

  return Math.max(Math.round(prediction), 0);
};

const buildSerializedModelBundle = (model, trainedRecords) => ({
  format: PREPARATION_ETA_MODEL_FORMAT,
  payload: {
    weights: model.weights,
    bias: model.bias,
    normalization: model.normalization,
  },
  metadata: {
    artifactVersion: PREPARATION_ETA_MODEL_VERSION,
    modelType: 'linear_regression',
    featureNames: getFeatureNames(),
    trainedRecords,
    minimumTrainingRows: MINIMUM_TRAINING_ROWS,
  },
});

const isNodeNativeBundle = (bundle) =>
  Boolean(
    bundle &&
      bundle.format === PREPARATION_ETA_MODEL_FORMAT &&
      bundle.payload &&
      Array.isArray(bundle.payload.weights) &&
      bundle.payload.normalization
  );

const loadNodeNativeBundle = (bundle, artifactSummary) => {
  const model = {
    weights: bundle.payload.weights.map((value) => Number(value)),
    bias: Number(bundle.payload.bias ?? 0),
    normalization: {
      count: Number(bundle.payload.normalization?.count ?? 0),
      means: (bundle.payload.normalization?.means ?? []).map((value) => Number(value)),
      scales: (bundle.payload.normalization?.scales ?? []).map((value) => {
        const numeric = Number(value);
        return numeric > 0 ? numeric : 1;
      }),
    },
  };

  setModelState({
    model,
    metadata: bundle.metadata ?? {},
    loadedFrom: 'database',
    availability: 'model',
    artifactSummary: {
      ...artifactSummary,
      modelAvailability: 'model',
      modelBundle: {
        format: bundle.format,
        metadata: bundle.metadata ?? {},
      },
    },
  });
};

export const initializePreparationEtaModel = async () => {
  if (!env.preparationEtaAiEnabled) {
    resetModelStateToFallback(null);
    console.log('[Preparation ETA][Backend] Local ETA model is disabled by configuration. Using fallback mode.');
    return MODEL_STATE;
  }

  const artifact = await PreparationEtaArtifact.findOne({
    key: PREPARATION_ETA_ARTIFACT_KEY,
  }).lean();
  const artifactSummary = summarizeArtifact(artifact);

  if (!artifact) {
    resetModelStateToFallback(null);
    console.log('[Preparation ETA][Backend] No stored ETA model artifact found. Using fallback mode.');
    return MODEL_STATE;
  }

  if (isNodeNativeBundle(artifact.modelBundle)) {
    loadNodeNativeBundle(artifact.modelBundle, artifactSummary);
    console.log('[Preparation ETA][Backend] Loaded Node-native ETA model artifact.', {
      trainedRecords: MODEL_STATE.metadata?.trainedRecords ?? 0,
      format: artifact.modelBundle.format,
    });
    return MODEL_STATE;
  }

  if (artifact.modelBundle?.blobBase64) {
    resetModelStateToFallback({
      ...artifactSummary,
      modelAvailability: 'legacy_unusable',
    });
    console.warn(
      '[Preparation ETA][Backend] Legacy Python ETA model artifact found. It will be ignored until retrained in Node.'
    );
    return MODEL_STATE;
  }

  resetModelStateToFallback(artifactSummary);
  console.log('[Preparation ETA][Backend] Stored ETA model artifact has no usable payload. Using fallback mode.');
  return MODEL_STATE;
};

export const getStoredPreparationEtaArtifact = async () => {
  const artifact = await PreparationEtaArtifact.findOne({
    key: PREPARATION_ETA_ARTIFACT_KEY,
  }).lean();

  if (!artifact) {
    return null;
  }

  return summarizeArtifact(artifact);
};

const persistPreparationEtaArtifact = async ({ modelBundle, trainedRecords, source }) => {
  const artifact = await PreparationEtaArtifact.findOneAndUpdate(
    { key: PREPARATION_ETA_ARTIFACT_KEY },
    {
      key: PREPARATION_ETA_ARTIFACT_KEY,
      source,
      trainedRecords: Math.max(Number(trainedRecords ?? 0), 0),
      modelBundle,
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  return summarizeArtifact(artifact);
};

export const predictPreparationEta = async (preparation) => {
  const payload = buildPredictionPayload(preparation);

  console.log('[Preparation ETA][Backend] Starting ETA prediction.', {
    preparationId: payload.preparationId,
    status: payload.status,
    requestedServices: payload.requestedServices,
    totalChecklistItems: payload.totalChecklistItems,
    completedChecklistItems: payload.completedChecklistItems,
    detailingRequested: payload.detailingRequested,
    detailingCompleted: payload.detailingCompleted,
  });

  if (!env.preparationEtaAiEnabled) {
    const fallbackPrediction = buildFallbackPrediction(payload);
    return {
      ...fallbackPrediction,
      fallbackReason: 'model_disabled',
    };
  }

  if (!MODEL_STATE.model) {
    const fallbackPrediction = buildFallbackPrediction(payload);
    console.log('[Preparation ETA][Backend] ETA prediction resolved via fallback.', {
      preparationId: payload.preparationId,
      predictedTotalMinutes: fallbackPrediction.predictedTotalMinutes,
      predictedRemainingMinutes: fallbackPrediction.predictedRemainingMinutes,
      availability: MODEL_STATE.availability,
    });
    return fallbackPrediction;
  }

  const features = toFeatureVector(payload);
  const predictedTotalMinutes = predictWithModel(MODEL_STATE.model, features);
  let predictedRemainingMinutes = Math.max(
    predictedTotalMinutes - Math.max(payload.elapsedMinutesSinceInDispatch, 0),
    0
  );

  if (payload.detailingRequested && payload.detailingCompleted) {
    predictedRemainingMinutes = Math.max(predictedRemainingMinutes - 30, 0);
  }

  const prediction = clampPredictionToServiceCap(payload, {
    predictedTotalMinutes,
    predictedRemainingMinutes,
    source: 'model',
    trainedRecords: MODEL_STATE.metadata?.trainedRecords ?? 0,
    modelType: MODEL_STATE.metadata?.modelType ?? 'linear_regression',
  });

  console.log('[Preparation ETA][Backend] ETA prediction resolved via in-process model.', {
    preparationId: payload.preparationId,
    predictedTotalMinutes: prediction.predictedTotalMinutes,
    predictedRemainingMinutes: prediction.predictedRemainingMinutes,
    trainedRecords: prediction.trainedRecords,
  });

  return prediction;
};

export const syncPreparationEtaPrediction = async (preparationId) => {
  const preparation = await Preparation.findById(preparationId);

  if (!preparation) {
    console.warn(
      '[Preparation ETA][Backend] Prediction sync skipped because preparation was not found.',
      {
        preparationId,
      }
    );
    return null;
  }

  const prediction = await predictPreparationEta(preparation);
  const nextSnapshot = applyPredictionSnapshot(preparation.toObject(), prediction);

  await Preparation.findByIdAndUpdate(preparationId, {
    predictedTotalMinutes: nextSnapshot.predictedTotalMinutes,
    predictedRemainingMinutes: nextSnapshot.predictedRemainingMinutes,
    predictionGeneratedAt: nextSnapshot.predictionGeneratedAt,
  });

  console.log('[Preparation ETA][Backend] Prediction snapshot saved on preparation.', {
    preparationId,
    predictedTotalMinutes: nextSnapshot.predictedTotalMinutes,
    predictedRemainingMinutes: nextSnapshot.predictedRemainingMinutes,
    predictionGeneratedAt: nextSnapshot.predictionGeneratedAt?.toISOString?.() ?? null,
  });

  return prediction;
};

export const retrainPreparationEtaModel = async () => {
  if (!env.preparationEtaAiEnabled) {
    resetModelStateToFallback(MODEL_STATE.artifactSummary);
    return {
      success: true,
      trainedRecords: 0,
      source: 'fallback',
      message: 'ETA model is disabled by configuration; skipped local retraining.',
    };
  }

  const completedPreparations = await Preparation.find({
    inDispatchAt: { $ne: null },
    readyForReleaseAt: { $ne: null },
  }).lean();

  const trainingRows = completedPreparations
    .map((preparation) => {
      const payload = buildPredictionPayload(preparation);
      const start = toDate(preparation.inDispatchAt);
      const end = toDate(preparation.readyForReleaseAt ?? preparation.completedAt);

      if (!start || !end || end <= start) {
        return null;
      }

      return {
        payload,
        durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000),
      };
    })
    .filter(Boolean);

  console.log('[Preparation ETA][Backend] Preparing local ETA model retraining payload.', {
    totalCompletedPreparations: completedPreparations.length,
    validTrainingRows: trainingRows.length,
  });

  if (trainingRows.length < MINIMUM_TRAINING_ROWS) {
    return {
      success: true,
      trainedRecords: trainingRows.length,
      source: 'fallback',
      message: 'Not enough completed preparation rows to train a model yet.',
    };
  }

  const xTrain = trainingRows.map((row) => toFeatureVector(row.payload));
  const yTrain = trainingRows.map((row) => row.durationMinutes);
  const model = fitLinearRegressionModel(xTrain, yTrain);
  const modelBundle = buildSerializedModelBundle(model, trainingRows.length);
  const artifactSummary = await persistPreparationEtaArtifact({
    modelBundle,
    trainedRecords: trainingRows.length,
    source: 'model',
  });

  setModelState({
    model,
    metadata: modelBundle.metadata,
    loadedFrom: 'train',
    availability: 'model',
    artifactSummary,
  });

  console.log('[Preparation ETA][Backend] Local ETA model retraining finished.', {
    trainedRecords: trainingRows.length,
    modelType: modelBundle.metadata.modelType,
  });

  return {
    success: true,
    trainedRecords: trainingRows.length,
    source: 'model',
    modelBundle: {
      format: modelBundle.format,
      metadata: modelBundle.metadata,
    },
  };
};

export const getPreparationEtaRuntimeState = () => ({
  modelReady: Boolean(MODEL_STATE.model),
  loadedFrom: MODEL_STATE.loadedFrom,
  modelAvailability: MODEL_STATE.availability,
  metadata: MODEL_STATE.metadata,
  artifactSummary: MODEL_STATE.artifactSummary,
});
