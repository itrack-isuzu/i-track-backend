import {
  DRIVER_AI_ALERT_SEVERITY,
  DRIVER_AI_EVENT_TYPES,
  DRIVER_AI_THRESHOLDS,
} from '../../config/driverAiConfig.js';
import {
  createNotificationsForRoles,
  createNotificationsForUsers,
} from '../notificationsService.js';

const ADMIN_ALERT_ROLES = ['admin', 'supervisor'];

const EVENT_COOLDOWN_SECONDS = {
  [DRIVER_AI_EVENT_TYPES.OVERSPEEDING]:
    DRIVER_AI_THRESHOLDS.overspeeding.cooldownSeconds,
  [DRIVER_AI_EVENT_TYPES.SUDDEN_STOP]:
    DRIVER_AI_THRESHOLDS.suddenStop.cooldownSeconds,
  [DRIVER_AI_EVENT_TYPES.HARSH_ACCELERATION]:
    DRIVER_AI_THRESHOLDS.harshAcceleration.cooldownSeconds,
  [DRIVER_AI_EVENT_TYPES.ROUTE_DEVIATION]:
    DRIVER_AI_THRESHOLDS.routeDeviation.cooldownSeconds,
  [DRIVER_AI_EVENT_TYPES.LONG_IDLE]:
    DRIVER_AI_THRESHOLDS.longIdle.cooldownSeconds,
  [DRIVER_AI_EVENT_TYPES.POSSIBLE_TRAFFIC_DELAY]:
    DRIVER_AI_THRESHOLDS.trafficDelay.cooldownSeconds,
};

const getId = (value) => String(value?.id ?? value ?? '').trim();

const getFullName = (person) =>
  `${person?.firstName ?? ''} ${person?.lastName ?? ''}`.trim();

const getVehicleLabel = (vehicle) =>
  [vehicle?.unitName, vehicle?.variation].filter(Boolean).join(' ').trim() ||
  'Assigned vehicle';

const buildAlertContent = ({ eventType, metadata = {}, allocation }) => {
  const vehicleLabel = getVehicleLabel(allocation?.vehicleId);
  const driverName = getFullName(allocation?.driverId) || 'The driver';

  switch (eventType) {
    case DRIVER_AI_EVENT_TYPES.OVERSPEEDING:
      return {
        title: 'Overspeeding detected',
        message: `${driverName} exceeded the speed threshold while driving ${vehicleLabel}.`,
      };
    case DRIVER_AI_EVENT_TYPES.SUDDEN_STOP:
      return {
        title: 'Sudden stop detected',
        message: `${driverName} made a sudden stop while driving ${vehicleLabel}.`,
      };
    case DRIVER_AI_EVENT_TYPES.HARSH_ACCELERATION:
      return {
        title: 'Harsh acceleration detected',
        message: `${driverName} accelerated aggressively while driving ${vehicleLabel}.`,
      };
    case DRIVER_AI_EVENT_TYPES.ROUTE_DEVIATION:
      return {
        title: 'Route deviation detected',
        message: `${driverName} is off the planned route by about ${Math.round(
          Number(metadata.distanceFromRouteMeters ?? 0)
        )} meters.`,
      };
    case DRIVER_AI_EVENT_TYPES.LONG_IDLE:
      return {
        title: 'Long idle detected',
        message: `${driverName} has been idle for about ${Math.round(
          Number(metadata.idleSeconds ?? 0)
        )} seconds.`,
      };
    case DRIVER_AI_EVENT_TYPES.POSSIBLE_TRAFFIC_DELAY:
      return {
        title: 'Possible trip delay detected',
        message: `${vehicleLabel} appears delayed based on low recent speed and trip progress.`,
      };
    default:
      return {
        title: 'Driver alert detected',
        message: `${driverName} triggered a driver behavior alert.`,
      };
  }
};

export const shouldCreateAlert = ({ alertState = {}, eventType, detectedAt }) => {
  const state = alertState?.[eventType] ?? null;

  if (!state?.lastAlertAt) {
    return true;
  }

  const lastAlertAt = new Date(state.lastAlertAt).getTime();
  const currentTime = new Date(detectedAt).getTime();
  const cooldownSeconds = EVENT_COOLDOWN_SECONDS[eventType] ?? 120;

  return currentTime - lastAlertAt >= cooldownSeconds * 1000;
};

export const buildAlertRecord = ({ eventType, allocation, detectedAt, metadata = {} }) => {
  const content = buildAlertContent({ eventType, metadata, allocation });

  return {
    type: eventType,
    severity: DRIVER_AI_ALERT_SEVERITY[eventType] ?? 'medium',
    title: content.title,
    message: content.message,
    detectedAt,
    metadata,
    status: 'open',
  };
};

export const createDriverBehaviorAlert = async ({
  allocation,
  eventType,
  detectedAt,
  metadata = {},
}) => {
  const alert = buildAlertRecord({
    eventType,
    allocation,
    detectedAt,
    metadata,
  });
  const managerId = getId(allocation?.managerId);
  const driverId = getId(allocation?.driverId);
  const recipientIds = [...new Set([managerId, driverId].filter(Boolean))];
  const notificationData = {
    entityType: 'driver_allocation',
    entityId: getId(allocation),
    vehicleId: getId(allocation?.vehicleId),
    driverId,
    alertType: eventType,
    severity: alert.severity,
    detectedAt,
    metadata,
  };

  if (recipientIds.length) {
    await createNotificationsForUsers({
      userIds: recipientIds,
      type: 'alert',
      title: alert.title,
      message: alert.message,
      data: notificationData,
    });
  } else {
    await createNotificationsForRoles({
      roles: ADMIN_ALERT_ROLES,
      type: 'alert',
      title: alert.title,
      message: alert.message,
      data: notificationData,
    });
  }

  return alert;
};
