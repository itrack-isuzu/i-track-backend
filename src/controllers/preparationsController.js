import { Preparation } from '../models/Preparation.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import {
  notifyPreparationCreated,
  notifyPreparationDeleted,
  notifyPreparationUpdated,
} from '../services/notificationDispatchers.js';
import {
  getPreparationEtaRuntimeState,
  getStoredPreparationEtaArtifact,
  retrainPreparationEtaModel,
  syncPreparationEtaPrediction,
} from '../services/preparationEtaService.js';
import { sendPreparationCompletionSms } from '../services/smsService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ensureValidPhoneNumber } from '../utils/phoneNumbers.js';

const dispatchNotificationTask = (task, label) => {
  void task.catch((error) => {
    console.error(`Notification dispatch failed (${label}):`, error);
  });
};

const preparationPopulation = [
  {
    path: 'vehicleId',
    select: 'unitName variation conductionNumber bodyColor status',
  },
  {
    path: 'dispatcherId',
    select: 'firstName lastName email role',
  },
];

const buildFilters = (query) => {
  const filters = {};

  if (query.status) {
    filters.status = query.status;
  }

  if (query.approvalStatus) {
    filters.approvalStatus = query.approvalStatus;
  }

  if (query.dispatcherId) {
    filters.dispatcherId = query.dispatcherId;
  }

  if (query.vehicleId) {
    filters.vehicleId = query.vehicleId;
  }

  return filters;
};

const lockedPreparationStatuses = new Set([
  'in_dispatch',
  'completed',
  'ready_for_release',
]);

const completionSmsEligibleStatuses = new Set([
  'completed',
  'ready_for_release',
]);

const activePreparationVehicleStatuses = new Set([
  'pending',
  'in_dispatch',
  'ready_for_release',
]);

const toOptionalDate = (value) => {
  if (!value) {
    return null;
  }

  const parsedDate = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const normalizeChecklistItems = (dispatcherChecklist, existingChecklist = []) => {
  if (!Array.isArray(dispatcherChecklist)) {
    return [];
  }

  return dispatcherChecklist.map((item, index) => {
    const existingItem = existingChecklist.find(
      (entry) =>
        String(entry?.id ?? '').trim() === String(item?.id ?? '').trim() &&
        String(entry?.label ?? '').trim() === String(item?.label ?? '').trim()
    );
    const completed = item?.completed === true;
    const explicitCompletedAt = toOptionalDate(item?.completedAt);

    return {
      id: String(item?.id ?? `dispatch-step-${index + 1}`).trim(),
      label: String(item?.label ?? '').trim(),
      completed,
      completedAt: completed
        ? explicitCompletedAt ?? toOptionalDate(existingItem?.completedAt) ?? new Date()
        : null,
    };
  });
};

const normalizePreparationEtaFields = ({
  status,
  approvedAt,
  inDispatchAt,
  existingInDispatchAt,
}) => {
  const resolvedApprovedAt = toOptionalDate(approvedAt);
  const resolvedInDispatchAt = toOptionalDate(inDispatchAt);
  const resolvedExistingInDispatchAt = toOptionalDate(existingInDispatchAt);

  return {
    inDispatchAt:
      status === 'in_dispatch' || status === 'completed' || status === 'ready_for_release'
        ? resolvedExistingInDispatchAt ??
          resolvedInDispatchAt ??
          resolvedApprovedAt ??
          new Date()
        : null,
  };
};

const normalizePreparationStatusDates = ({
  status,
  completedAt,
  readyForReleaseAt,
  completionFallbackDate,
  readyForReleaseFallbackDate,
}) => {
  const resolvedCompletedAt = toOptionalDate(completedAt);
  const resolvedReadyForReleaseAt = toOptionalDate(readyForReleaseAt);
  const resolvedCompletionFallbackDate =
    toOptionalDate(completionFallbackDate) ?? new Date();
  const resolvedReadyForReleaseFallbackDate =
    toOptionalDate(readyForReleaseFallbackDate) ??
    resolvedCompletionFallbackDate;

  if (status === 'completed') {
    const normalizedReadyForReleaseAt =
      resolvedReadyForReleaseAt ??
      resolvedReadyForReleaseFallbackDate ??
      resolvedCompletedAt ??
      new Date();

    return {
      completedAt:
        resolvedCompletedAt ?? resolvedCompletionFallbackDate ?? new Date(),
      readyForReleaseAt: normalizedReadyForReleaseAt,
    };
  }

  if (status === 'ready_for_release') {
    return {
      completedAt: null,
      readyForReleaseAt:
        resolvedReadyForReleaseAt ??
        resolvedReadyForReleaseFallbackDate ??
        resolvedCompletedAt ??
        new Date(),
    };
  }

  return {
    completedAt: null,
    readyForReleaseAt: null,
  };
};

const normalizeArrayValues = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];

const normalizeOptionalText = (value) => String(value ?? '').trim();

const getPreparationVehicleLabel = (preparation) =>
  [
    preparation?.vehicleId?.unitName,
    preparation?.vehicleId?.variation,
  ]
    .filter(Boolean)
    .join(' ')
    .trim() || 'your vehicle';

const ensurePreparationVehicleAvailable = (vehicle) => {
  if (vehicle?.status === 'available') {
    return;
  }

  const error = new Error(
    'Only vehicles with Available status can be used for preparation.'
  );
  error.statusCode = 400;
  throw error;
};

const reconcilePreparationVehicleStatus = async (vehicleId) => {
  if (!vehicleId) {
    return;
  }

  const latestActivePreparation = await Preparation.findOne({
    vehicleId,
    status: { $in: [...activePreparationVehicleStatuses] },
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .select('_id');

  const nextVehicleStatus = latestActivePreparation
    ? 'under_preparation'
    : 'available';

  await Vehicle.findByIdAndUpdate(vehicleId, {
    status: nextVehicleStatus,
  });
};

const hasEditablePreparationFieldChanges = ({
  existingPreparation,
  nextPayload,
}) => {
  if (String(existingPreparation.vehicleId) !== String(nextPayload.vehicleId)) {
    return true;
  }

  if (
    normalizeOptionalText(existingPreparation.customerName) !==
    normalizeOptionalText(nextPayload.customerName)
  ) {
    return true;
  }

  if (
    normalizeOptionalText(existingPreparation.customerContactNo) !==
    normalizeOptionalText(nextPayload.customerContactNo)
  ) {
    return true;
  }

  if (
    normalizeOptionalText(existingPreparation.notes) !==
    normalizeOptionalText(nextPayload.notes)
  ) {
    return true;
  }

  if (
    normalizeArrayValues(existingPreparation.requestedServices).join('|') !==
    normalizeArrayValues(nextPayload.requestedServices).join('|')
  ) {
    return true;
  }

  return (
    normalizeArrayValues(existingPreparation.customRequests).join('|') !==
    normalizeArrayValues(nextPayload.customRequests).join('|')
  );
};

const ensurePreparationEditAllowed = ({ existingPreparation, nextPayload }) => {
  if (!lockedPreparationStatuses.has(existingPreparation.status)) {
    return;
  }

  if (!hasEditablePreparationFieldChanges({ existingPreparation, nextPayload })) {
    return;
  }

  const error = new Error(
    'Preparation records in In Dispatch, Completed, or Ready for Release status can no longer be edited.'
  );
  error.statusCode = 409;
  throw error;
};

const shouldSendPreparationCompletionSms = ({
  previousPreparation,
  nextPreparation,
}) => {
  console.log('[SMS][Preparation] Evaluating completion SMS trigger.', {
    preparationId: nextPreparation?.id ?? null,
    previousStatus: previousPreparation?.status ?? null,
    nextStatus: nextPreparation?.status ?? null,
    customerContactNo: nextPreparation?.customerContactNo ?? null,
    completionSmsSentAt: nextPreparation?.completionSmsSentAt ?? null,
    completionSmsDispatchStartedAt:
      nextPreparation?.completionSmsDispatchStartedAt ?? null,
  });

  if (
    !nextPreparation?.customerContactNo ||
    nextPreparation?.completionSmsSentAt ||
    nextPreparation?.completionSmsDispatchStartedAt
  ) {
    console.log(
      '[SMS][Preparation] Skipping SMS trigger because contact number is missing or a send already exists/is running.'
    );
    return false;
  }

  if (!completionSmsEligibleStatuses.has(nextPreparation?.status)) {
    console.log('[SMS][Preparation] Skipping SMS trigger because status is not eligible.', {
      allowedStatuses: Array.from(completionSmsEligibleStatuses),
    });
    return false;
  }

  console.log('[SMS][Preparation] SMS trigger decision.', {
    shouldSend: previousPreparation?.status !== nextPreparation?.status,
  });

  return previousPreparation?.status !== nextPreparation?.status;
};

const syncPreparationCompletionSms = async ({
  previousPreparation,
  nextPreparation,
}) => {
  if (
    !shouldSendPreparationCompletionSms({
      previousPreparation,
      nextPreparation,
    })
  ) {
    console.log('[SMS][Preparation] SMS sync exited early because trigger returned false.', {
      preparationId: nextPreparation?.id ?? null,
    });
    return null;
  }

  try {
    console.log('[SMS][Preparation] Attempting to claim SMS dispatch.', {
      preparationId: nextPreparation.id,
    });

    const claimedPreparation = await Preparation.findOneAndUpdate(
      {
        _id: nextPreparation.id,
        completionSmsSentAt: null,
        completionSmsDispatchStartedAt: null,
      },
      {
        completionSmsDispatchStartedAt: new Date(),
        completionSmsLastError: null,
      },
      {
        new: true,
      }
    );

    if (!claimedPreparation) {
      console.log(
        '[SMS][Preparation] SMS dispatch claim skipped because another process may have handled it.'
      );
      return null;
    }

    console.log('[SMS][Preparation] SMS dispatch claimed successfully.', {
      preparationId: nextPreparation.id,
      customerName: nextPreparation.customerName,
      customerContactNo: nextPreparation.customerContactNo,
    });

    const smsResult = await sendPreparationCompletionSms({
      customerName: nextPreparation.customerName,
      phoneNumber: nextPreparation.customerContactNo,
      vehicleLabel: getPreparationVehicleLabel(nextPreparation),
    });

    if (smsResult?.skipped) {
      console.warn('[SMS][Preparation] SMS send skipped by provider configuration.', {
        preparationId: nextPreparation.id,
        result: smsResult,
      });

      await Preparation.findByIdAndUpdate(nextPreparation.id, {
        completionSmsDispatchStartedAt: null,
      });

      return smsResult;
    }

    await Preparation.findByIdAndUpdate(nextPreparation.id, {
      completionSmsSentAt: new Date(),
      completionSmsDispatchStartedAt: null,
      completionSmsLastError: null,
    });

    console.log('[SMS][Preparation] SMS send completed successfully.', {
      preparationId: nextPreparation.id,
      result: smsResult,
    });

    return smsResult;
  } catch (error) {
    console.error('[SMS][Preparation] SMS send failed.', {
      preparationId: nextPreparation.id,
      error: String(error?.message ?? error ?? 'Unable to send SMS.'),
    });

    await Preparation.findByIdAndUpdate(nextPreparation.id, {
      completionSmsDispatchStartedAt: null,
      completionSmsLastError:
        String(error?.message ?? error ?? 'Unable to send SMS.').trim() ||
        'Unable to send SMS.',
    }).catch(() => undefined);

    throw error;
  }
};

const dispatchPreparationCompletionSmsTask = ({
  previousPreparation,
  nextPreparation,
}) => {
  console.log('[SMS][Preparation] Queueing completion SMS background task.', {
    preparationId: nextPreparation?.id ?? null,
    previousStatus: previousPreparation?.status ?? null,
    nextStatus: nextPreparation?.status ?? null,
  });

  dispatchNotificationTask(
    syncPreparationCompletionSms({
      previousPreparation,
      nextPreparation,
    }),
    'preparation completion sms'
  );
};

const requireVehicle = async (vehicleId) => {
  const vehicle = await Vehicle.findById(vehicleId);

  if (!vehicle) {
    const error = new Error('Vehicle not found.');
    error.statusCode = 400;
    throw error;
  }

  return vehicle;
};

const requireDispatcher = async (dispatcherId) => {
  if (!dispatcherId) {
    return null;
  }

  const dispatcher = await User.findById(dispatcherId);

  if (!dispatcher) {
    const error = new Error('Dispatcher not found.');
    error.statusCode = 400;
    throw error;
  }

  return dispatcher;
};

const requireOptionalRequester = async (requesterId) => {
  if (!requesterId) {
    return null;
  }

  const requester = await User.findById(requesterId);

  if (!requester) {
    const error = new Error('Requester not found.');
    error.statusCode = 400;
    throw error;
  }

  return requester;
};

const requirePreparation = async (id) => {
  const preparation = await Preparation.findById(id).populate(
    preparationPopulation
  );

  if (!preparation) {
    const error = new Error('Preparation record not found.');
    error.statusCode = 404;
    throw error;
  }

  return preparation;
};

const buildValidatedPayload = async ({
  vehicleId,
  requestedByUserId,
  requestedServices,
  customRequests,
  customerName,
  customerContactNo,
  notes,
  status,
  progress,
  requestedByRole,
  requestedByName,
  approvalStatus,
  approvedByRole,
  approvedByName,
  approvedAt,
  dispatcherId,
  dispatcherChecklist,
  inDispatchAt,
  completedAt,
  readyForReleaseAt,
  existingPreparation,
}) => {
  const normalizedPhoneNumber = ensureValidPhoneNumber(
    customerContactNo,
    'Customer contact number'
  );
  const normalizedChecklist = normalizeChecklistItems(
    dispatcherChecklist,
    existingPreparation?.dispatcherChecklist
  );

  return {
    vehicleId,
    requestedByUserId: requestedByUserId ?? null,
    requestedServices,
    customRequests,
    customerName:
      typeof customerName === 'string' ? customerName.trim() : customerName,
    customerContactNo: normalizedPhoneNumber,
    notes: typeof notes === 'string' ? notes.trim() : notes,
    status,
    progress,
    requestedByRole,
    requestedByName:
      typeof requestedByName === 'string' ? requestedByName.trim() : requestedByName,
    approvalStatus,
    approvedByRole,
    approvedByName:
      typeof approvedByName === 'string' ? approvedByName.trim() : approvedByName,
    approvedAt,
    dispatcherId: dispatcherId ?? null,
    dispatcherChecklist: normalizedChecklist,
    inDispatchAt:
      normalizePreparationEtaFields({
        status,
        approvedAt,
        inDispatchAt,
        existingInDispatchAt: existingPreparation?.inDispatchAt,
      }).inDispatchAt,
    completedAt,
    readyForReleaseAt,
  };
};

const validatePayload = async (
  payload,
  { requireAvailableVehicle = false } = {}
) => {
  const [vehicle] = await Promise.all([
    requireVehicle(payload.vehicleId),
    requireDispatcher(payload.dispatcherId),
    requireOptionalRequester(payload.requestedByUserId),
  ]);

  if (requireAvailableVehicle) {
    ensurePreparationVehicleAvailable(vehicle);
  }
};

export const listPreparations = asyncHandler(async (req, res) => {
  const preparations = await Preparation.find(buildFilters(req.query))
    .populate(preparationPopulation)
    .sort({ createdAt: -1 });

  sendSuccess(res, {
    data: preparations,
    message: 'Preparation records fetched successfully.',
  });
});

export const getPreparationById = asyncHandler(async (req, res) => {
  const preparation = await requirePreparation(req.params.id);

  sendSuccess(res, {
    data: preparation,
    message: 'Preparation record fetched successfully.',
  });
});

export const createPreparation = asyncHandler(async (req, res) => {
  const validatedPayload = await buildValidatedPayload(req.body ?? {});
  const normalizedPayload = {
    ...validatedPayload,
    ...normalizePreparationStatusDates({
      status: validatedPayload.status,
      completedAt: validatedPayload.completedAt,
      readyForReleaseAt: validatedPayload.readyForReleaseAt,
    }),
  };
  await validatePayload(normalizedPayload, {
    requireAvailableVehicle: true,
  });
  const preparation = await Preparation.create(normalizedPayload);
  await syncPreparationEtaPrediction(preparation.id);
  await reconcilePreparationVehicleStatus(normalizedPayload.vehicleId);
  const savedPreparation = await requirePreparation(preparation.id);
  dispatchNotificationTask(
    notifyPreparationCreated(savedPreparation),
    'preparation create'
  );
  dispatchPreparationCompletionSmsTask({
    previousPreparation: null,
    nextPreparation: savedPreparation,
  });

  sendSuccess(res, {
    status: 201,
    data: savedPreparation,
    message: 'Preparation record created successfully.',
  });
});

export const updatePreparation = asyncHandler(async (req, res) => {
  const previousPreparation = await requirePreparation(req.params.id);
  const existingPreparation = await Preparation.findById(req.params.id);

  if (!existingPreparation) {
    const error = new Error('Preparation record not found.');
    error.statusCode = 404;
    throw error;
  }

  const validatedPayload = await buildValidatedPayload({
    vehicleId: req.body?.vehicleId ?? existingPreparation.vehicleId,
    requestedServices:
      req.body?.requestedServices ?? existingPreparation.requestedServices,
    customRequests:
      req.body?.customRequests ?? existingPreparation.customRequests,
    customerName:
      req.body?.customerName ?? existingPreparation.customerName,
    customerContactNo:
      req.body?.customerContactNo ?? existingPreparation.customerContactNo,
    notes: req.body?.notes ?? existingPreparation.notes,
    status: req.body?.status ?? existingPreparation.status,
    progress: req.body?.progress ?? existingPreparation.progress,
    requestedByRole:
      req.body?.requestedByRole ?? existingPreparation.requestedByRole,
    requestedByName:
      req.body?.requestedByName ?? existingPreparation.requestedByName,
    approvalStatus:
      req.body?.approvalStatus ?? existingPreparation.approvalStatus,
    approvedByRole:
      req.body?.approvedByRole ?? existingPreparation.approvedByRole,
    approvedByName:
      req.body?.approvedByName ?? existingPreparation.approvedByName,
    approvedAt: req.body?.approvedAt ?? existingPreparation.approvedAt,
    dispatcherId:
      req.body?.dispatcherId === undefined
        ? existingPreparation.dispatcherId
        : req.body.dispatcherId,
    dispatcherChecklist:
      req.body?.dispatcherChecklist ?? existingPreparation.dispatcherChecklist,
    inDispatchAt: req.body?.inDispatchAt ?? existingPreparation.inDispatchAt,
    completedAt: req.body?.completedAt ?? existingPreparation.completedAt,
    readyForReleaseAt:
      req.body?.readyForReleaseAt ?? existingPreparation.readyForReleaseAt,
    requestedByUserId:
      req.body?.requestedByUserId === undefined
        ? existingPreparation.requestedByUserId
        : req.body.requestedByUserId,
    existingPreparation,
  });
  const normalizedPayload = {
    ...validatedPayload,
    ...normalizePreparationStatusDates({
      status: validatedPayload.status,
      completedAt: validatedPayload.completedAt,
      readyForReleaseAt: validatedPayload.readyForReleaseAt,
      completionFallbackDate: existingPreparation.completedAt ?? new Date(),
      readyForReleaseFallbackDate:
        existingPreparation.readyForReleaseAt ??
        existingPreparation.completedAt ??
        new Date(),
    }),
  };
  ensurePreparationEditAllowed({
    existingPreparation,
    nextPayload: normalizedPayload,
  });
  await validatePayload(normalizedPayload, {
    requireAvailableVehicle:
      String(normalizedPayload.vehicleId) !== String(existingPreparation.vehicleId),
  });

  await Preparation.findByIdAndUpdate(req.params.id, normalizedPayload, {
    new: true,
    runValidators: true,
  });
  await syncPreparationEtaPrediction(req.params.id);

  await Promise.all([
    reconcilePreparationVehicleStatus(existingPreparation.vehicleId),
    reconcilePreparationVehicleStatus(normalizedPayload.vehicleId),
  ]);

  const savedPreparation = await requirePreparation(req.params.id);
  dispatchNotificationTask(
    notifyPreparationUpdated({
      previousPreparation,
      nextPreparation: savedPreparation,
    }),
    'preparation update'
  );
  dispatchPreparationCompletionSmsTask({
    previousPreparation,
    nextPreparation: savedPreparation,
  });

  sendSuccess(res, {
    data: savedPreparation,
    message: 'Preparation record updated successfully.',
  });
});

export const retrainPreparationEta = asyncHandler(async (req, res) => {
  void req;

  const result = await retrainPreparationEtaModel();

  sendSuccess(res, {
    data: result,
    message: 'Preparation ETA model retrained successfully.',
  });
});

export const getPreparationEtaModel = asyncHandler(async (req, res) => {
  void req;

  const artifact = await getStoredPreparationEtaArtifact();
  const runtimeState = getPreparationEtaRuntimeState();

  sendSuccess(res, {
    data: {
      artifact,
      runtime: {
        modelReady: runtimeState.modelReady,
        loadedFrom: runtimeState.loadedFrom,
        modelAvailability: runtimeState.modelAvailability,
        metadata: runtimeState.metadata,
      },
    },
    message: artifact
      ? 'Preparation ETA model artifact fetched successfully.'
      : 'No preparation ETA model artifact is stored yet; fallback mode is active.',
  });
});

export const deletePreparation = asyncHandler(async (req, res) => {
  const existingPreparation = await requirePreparation(req.params.id);
  const preparation = await Preparation.findByIdAndDelete(req.params.id);

  if (!preparation) {
    const error = new Error('Preparation record not found.');
    error.statusCode = 404;
    throw error;
  }

  await reconcilePreparationVehicleStatus(preparation.vehicleId);

  dispatchNotificationTask(
    notifyPreparationDeleted(existingPreparation),
    'preparation delete'
  );

  sendSuccess(res, {
    data: preparation,
    message: 'Preparation record deleted successfully.',
  });
});
