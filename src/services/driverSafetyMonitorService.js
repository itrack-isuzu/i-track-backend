import { DRIVER_AI_THRESHOLDS } from '../config/driverAiConfig.js';
import { DriverAllocation } from '../models/DriverAllocation.js';
import {
  notifyDriverEtaOverdue,
  notifyDriverGpsConnectionLost,
  notifyDriverShipmentStartOverdue,
} from './notificationDispatchers.js';

const IN_TRANSIT_STATUS = 'in_transit';
const NOT_STARTED_STATUSES = ['pending', 'assigned'];
const allocationPopulation = [
  {
    path: 'managerId',
    select: 'firstName lastName email role',
  },
  {
    path: 'driverId',
    select: 'firstName lastName email phone role',
  },
  {
    path: 'vehicleId',
    select: 'unitName variation conductionNumber bodyColor status',
  },
];

let monitorTimer = null;
let isScanRunning = false;

const getTime = (value) => {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

const isCooldownElapsed = (lastNotifiedAt, now) => {
  const lastNotifiedTime = getTime(lastNotifiedAt);

  if (!lastNotifiedTime) {
    return true;
  }

  return (
    now.getTime() - lastNotifiedTime >=
    DRIVER_AI_THRESHOLDS.safetyMonitor.alertCooldownSeconds * 1000
  );
};

const getGpsStaleSeconds = (allocation, now) => {
  const latestGpsTime = getTime(
    allocation.currentLocation?.updatedAt ?? allocation.currentLocation?.timestamp
  );

  if (latestGpsTime) {
    const staleSeconds = Math.floor((now.getTime() - latestGpsTime) / 1000);

    return staleSeconds >= DRIVER_AI_THRESHOLDS.safetyMonitor.gpsLostAfterSeconds
      ? staleSeconds
      : null;
  }

  const startTime = getTime(allocation.startTime);

  if (!startTime) {
    return null;
  }

  const missingSeconds = Math.floor((now.getTime() - startTime) / 1000);

  return missingSeconds >=
    DRIVER_AI_THRESHOLDS.safetyMonitor.gpsMissingAfterTripStartSeconds
    ? missingSeconds
    : null;
};

const getEtaOverdueMinutes = (allocation, now) => {
  const startTime = getTime(allocation.startTime);
  const estimatedDuration = Number(allocation.estimatedDuration ?? 0);

  if (!startTime || !Number.isFinite(estimatedDuration) || estimatedDuration <= 0) {
    return null;
  }

  const elapsedMinutes = Math.floor((now.getTime() - startTime) / 60000);
  const allowedMinutes =
    estimatedDuration +
    Math.max(
      DRIVER_AI_THRESHOLDS.safetyMonitor.etaGraceMinutes,
      Math.ceil(estimatedDuration * DRIVER_AI_THRESHOLDS.safetyMonitor.etaGraceRatio)
    );

  return elapsedMinutes > allowedMinutes ? elapsedMinutes - estimatedDuration : null;
};

const getShipmentStartOverdueMinutes = (allocation, now) => {
  if (!NOT_STARTED_STATUSES.includes(allocation.status)) {
    return null;
  }

  const scheduledTime = getTime(allocation.scheduledShipmentAt);

  if (!scheduledTime) {
    return null;
  }

  const overdueMinutes = Math.floor((now.getTime() - scheduledTime) / 60000);

  return overdueMinutes > DRIVER_AI_THRESHOLDS.safetyMonitor.shipmentStartGraceMinutes
    ? overdueMinutes
    : null;
};

const markSafetyAlertNotified = async (allocationId, field, detectedAt) =>
  DriverAllocation.findByIdAndUpdate(allocationId, {
    $set: {
      [`aiState.${field}`]: detectedAt,
    },
  });

export const scanDriverSafetyAlerts = async (detectedAt = new Date()) => {
  if (isScanRunning) {
    return {
      skipped: true,
      reason: 'scan_already_running',
    };
  }

  isScanRunning = true;

  try {
    const allocations = await DriverAllocation.find({
      status: {
        $in: [IN_TRANSIT_STATUS, ...NOT_STARTED_STATUSES],
      },
    }).populate(allocationPopulation);
    const summary = {
      scanned: allocations.length,
      gpsLostAlerts: 0,
      etaOverdueAlerts: 0,
      shipmentStartOverdueAlerts: 0,
    };

    for (const allocation of allocations) {
      const shipmentStartOverdueMinutes = getShipmentStartOverdueMinutes(
        allocation,
        detectedAt
      );

      if (
        shipmentStartOverdueMinutes !== null &&
        isCooldownElapsed(
          allocation.aiState?.lastShipmentStartOverdueNotifiedAt,
          detectedAt
        )
      ) {
        await markSafetyAlertNotified(
          allocation.id,
          'lastShipmentStartOverdueNotifiedAt',
          detectedAt
        );
        await notifyDriverShipmentStartOverdue(allocation, {
          overdueMinutes: shipmentStartOverdueMinutes,
          detectedAt,
        });
        summary.shipmentStartOverdueAlerts += 1;
      }

      if (allocation.status !== IN_TRANSIT_STATUS) {
        continue;
      }

      const gpsStaleSeconds = getGpsStaleSeconds(allocation, detectedAt);

      if (gpsStaleSeconds === null && allocation.aiState?.lastGpsLostNotifiedAt) {
        await DriverAllocation.findByIdAndUpdate(allocation.id, {
          $set: { 'aiState.lastGpsLostNotifiedAt': null },
        });
      }

      if (gpsStaleSeconds !== null && !allocation.aiState?.lastGpsLostNotifiedAt) {
        await notifyDriverGpsConnectionLost(allocation, {
          staleSeconds: gpsStaleSeconds,
          detectedAt,
        });
        await markSafetyAlertNotified(allocation.id, 'lastGpsLostNotifiedAt', detectedAt);
        summary.gpsLostAlerts += 1;
      }

      const etaOverdueMinutes = getEtaOverdueMinutes(allocation, detectedAt);

      if (
        etaOverdueMinutes !== null &&
        isCooldownElapsed(allocation.aiState?.lastEtaOverdueNotifiedAt, detectedAt)
      ) {
        await markSafetyAlertNotified(
          allocation.id,
          'lastEtaOverdueNotifiedAt',
          detectedAt
        );
        await notifyDriverEtaOverdue(allocation, {
          overdueMinutes: etaOverdueMinutes,
          detectedAt,
        });
        summary.etaOverdueAlerts += 1;
      }
    }

    return summary;
  } finally {
    isScanRunning = false;
  }
};

export const startDriverSafetyMonitor = () => {
  if (monitorTimer) {
    return monitorTimer;
  }

  const scanIntervalMs =
    DRIVER_AI_THRESHOLDS.safetyMonitor.scanIntervalSeconds * 1000;

  monitorTimer = setInterval(() => {
    void scanDriverSafetyAlerts().catch((error) => {
      console.error(
        '[driver-safety-monitor] Safety scan failed:',
        error instanceof Error ? error.message : error
      );
    });
  }, scanIntervalMs);
  monitorTimer.unref?.();

  void scanDriverSafetyAlerts().catch((error) => {
    console.error(
      '[driver-safety-monitor] Initial safety scan failed:',
      error instanceof Error ? error.message : error
    );
  });

  return monitorTimer;
};
