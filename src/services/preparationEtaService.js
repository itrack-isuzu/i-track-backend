import { env } from '../config/env.js';
import { PreparationEtaArtifact } from '../models/PreparationEtaArtifact.js';
import { Preparation } from '../models/Preparation.js';

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

const getRequestedServiceCount = (payload) =>
  (Array.isArray(payload?.requestedServices) ? payload.requestedServices.length : 0) +
  Math.max(Number(payload?.customRequestsCount ?? 0), 0);

const getMaxAllowedTotalMinutes = (payload) => Math.max(getRequestedServiceCount(payload), 1) * 60;

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

export const buildPredictionPayload = (preparation) => {
  const requestedServices = buildRequestedServiceSet(preparation);
  const checklist = buildChecklist(preparation);
  const completedChecklistItems = checklist.filter((item) => item.completed);
  const detailingChecklistItem = checklist.find(
    (item) => item.id === 'detailing' || item.label.toLowerCase() === 'detailing'
  );
  //repalace completedAt to readyForReleaseAt 
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

const buildFallbackPrediction = (payload) => {
  const serviceWeights = {
    detailing: 180,
    carwash: 60,
    tinting: 150,
    ceramic_coating: 240,
    accessories: 120,
    rust_proof: 120,
    inspection: 45,
    maintenance: 180,
    painting: 300,
  };

  let predictedTotalMinutes = 60;

  for (const [serviceType, enabled] of Object.entries(payload.serviceFlags ?? {})) {
    if (enabled) {
      predictedTotalMinutes += serviceWeights[serviceType] ?? 90;
    }
  }

  predictedTotalMinutes += (payload.customRequestsCount ?? 0) * 45;
  predictedTotalMinutes += Math.max((payload.totalChecklistItems ?? 0) - 1, 0) * 15;

  if (payload.detailingRequested && !payload.detailingCompleted) {
    predictedTotalMinutes += 60;
  }

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
    fallbackReason: 'python_service_unavailable',
  });
};

const postJson = async (path, payload) => {
  const response = await fetch(`${env.preparationEtaAiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(env.preparationEtaAiKey
        ? { Authorization: `Bearer ${env.preparationEtaAiKey}` }
        : {}),
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  const parsed = rawText ? JSON.parse(rawText) : {};

  if (!response.ok) {
    const error = new Error(
      parsed?.detail || parsed?.message || `ETA AI request failed with ${response.status}.`
    );
    error.statusCode = response.status;
    throw error;
  }

  return parsed;
};

export const getStoredPreparationEtaArtifact = async () =>
  PreparationEtaArtifact.findOne({ key: PREPARATION_ETA_ARTIFACT_KEY }).lean();

const storePreparationEtaArtifact = async (result) => {
  const blobBase64 = result?.modelBundle?.blobBase64;

  if (!blobBase64) {
    console.log('[Preparation ETA][Backend] No serialized model bundle returned to store.', {
      source: result?.source ?? null,
      trainedRecords: result?.trainedRecords ?? null,
    });
    return null;
  }

  const artifact = await PreparationEtaArtifact.findOneAndUpdate(
    { key: PREPARATION_ETA_ARTIFACT_KEY },
    {
      key: PREPARATION_ETA_ARTIFACT_KEY,
      source: result?.source ?? 'model',
      trainedRecords: Math.max(Number(result?.trainedRecords ?? 0), 0),
      modelBundle: {
        blobBase64,
        metadata: result?.modelBundle?.metadata ?? {},
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  console.log('[Preparation ETA][Backend] Serialized model bundle stored in MongoDB.', {
    artifactId: artifact?.id ?? null,
    trainedRecords: artifact?.trainedRecords ?? 0,
    source: artifact?.source ?? null,
    blobLength: blobBase64.length,
  });

  return artifact;
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

  if (!env.preparationEtaAiEnabled || !env.preparationEtaAiUrl) {
    const fallbackPrediction = buildFallbackPrediction(payload);
    console.log('[Preparation ETA][Backend] ETA prediction resolved via local fallback.', {
      preparationId: payload.preparationId,
      predictedTotalMinutes: fallbackPrediction.predictedTotalMinutes,
      predictedRemainingMinutes: fallbackPrediction.predictedRemainingMinutes,
      source: fallbackPrediction.source,
    });
    return fallbackPrediction;
  }

  try {
    const prediction = clampPredictionToServiceCap(
      payload,
      await postJson('/predict', payload)
    );
    console.log('[Preparation ETA][Backend] ETA prediction resolved via AI service.', {
      preparationId: payload.preparationId,
      predictedTotalMinutes: prediction?.predictedTotalMinutes ?? null,
      predictedRemainingMinutes: prediction?.predictedRemainingMinutes ?? null,
      maxAllowedTotalMinutes: prediction?.maxAllowedTotalMinutes ?? null,
      source: prediction?.source ?? 'model',
    });
    return prediction;
  } catch (error) {
    console.warn('[Preparation ETA] Falling back to local estimate.', {
      preparationId: payload.preparationId,
      error: String(error?.message ?? error),
    });
    const fallbackPrediction = buildFallbackPrediction(payload);
    console.log('[Preparation ETA][Backend] ETA prediction resolved via fallback after AI error.', {
      preparationId: payload.preparationId,
      predictedTotalMinutes: fallbackPrediction.predictedTotalMinutes,
      predictedRemainingMinutes: fallbackPrediction.predictedRemainingMinutes,
      source: fallbackPrediction.source,
    });
    return fallbackPrediction;
  }
};

export const syncPreparationEtaPrediction = async (preparationId) => {
  const preparation = await Preparation.findById(preparationId);

  if (!preparation) {
    console.warn('[Preparation ETA][Backend] Prediction sync skipped because preparation was not found.', {
      preparationId,
    });
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
        ...payload,
        durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000),
      };
    })
    .filter(Boolean);

  console.log('[Preparation ETA][Backend] Preparing ETA model retraining payload.', {
    totalCompletedPreparations: completedPreparations.length,
    validTrainingRows: trainingRows.length,
  });

  if (!env.preparationEtaAiEnabled || !env.preparationEtaAiUrl) {
    return {
      success: true,
      trainedRecords: trainingRows.length,
      source: 'fallback',
      message: 'ETA AI is disabled; skipped remote retraining.',
    };
  }

  const result = await postJson('/train', {
    rows: trainingRows,
  });

  await storePreparationEtaArtifact(result);

  console.log('[Preparation ETA][Backend] ETA model retraining finished.', {
    trainedRecords: result?.trainedRecords ?? null,
    source: result?.source ?? null,
    success: result?.success ?? true,
  });

  return result;
};
