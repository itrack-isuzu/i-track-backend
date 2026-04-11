import {
  DRIVER_AI_EVENT_TYPES,
  DRIVER_AI_THRESHOLDS,
} from '../../config/driverAiConfig.js';
import {
  averageSpeedKph,
  computeRouteProgress,
  deriveSpeedKph,
  distanceToPolylineMeters,
  getElapsedSeconds,
  haversineDistanceMeters,
} from '../../utils/driverAiGeo.js';
import { createDriverBehaviorAlert, shouldCreateAlert } from './alertService.js';
import { calculateDriverScore } from './scoreService.js';

const ACTIVE_CONDITION_TYPES = [
  DRIVER_AI_EVENT_TYPES.OVERSPEEDING,
  DRIVER_AI_EVENT_TYPES.ROUTE_DEVIATION,
  DRIVER_AI_EVENT_TYPES.LONG_IDLE,
  DRIVER_AI_EVENT_TYPES.POSSIBLE_TRAFFIC_DELAY,
];

const buildDefaultAlertState = () =>
  ACTIVE_CONDITION_TYPES.reduce((accumulator, eventType) => {
    accumulator[eventType] = {
      active: false,
      startedAt: null,
      lastAlertAt: null,
    };
    return accumulator;
  }, {});

const buildDefaultAiState = () => ({
  recentLocations: [],
  alertState: buildDefaultAlertState(),
  lastIgnoredPoint: null,
  lastAnalyzedAt: null,
});

const buildBehaviorEvent = ({ type, detectedAt, metadata = {} }) => ({
  type,
  severity: metadata.severity ?? 'medium',
  detectedAt,
  metadata,
});

const normalizeDate = (value) => {
  const parsed = new Date(value ?? Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const trimArray = (items, maxItems) => items.slice(-maxItems);

const getRoutePoints = (allocation) => {
  const routeCoordinates = allocation?.plannedRoute?.coordinates;

  if (Array.isArray(routeCoordinates) && routeCoordinates.length >= 2) {
    return routeCoordinates
      .map((point) => ({
        latitude: Number(point.latitude),
        longitude: Number(point.longitude),
      }))
      .filter(
        (point) =>
          Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
      );
  }

  return [allocation?.pickupLocation, allocation?.destinationLocation]
    .map((point) =>
      point
        ? {
            latitude: Number(point.latitude),
            longitude: Number(point.longitude),
          }
        : null
    )
    .filter(Boolean);
};

const normalizeSpeedKph = ({ incomingLocation, previousPoint }) => {
  const directSpeed = Number(incomingLocation?.speed);

  if (Number.isFinite(directSpeed) && directSpeed >= 0) {
    return directSpeed;
  }

  return deriveSpeedKph({
    previousPoint,
    currentPoint: incomingLocation,
  });
};

const buildAnalyzedPoint = ({ incomingLocation, previousPoint }) => {
  const timestamp = normalizeDate(
    incomingLocation?.timestamp ?? incomingLocation?.updatedAt
  );
  const accuracy =
    incomingLocation?.accuracy === undefined || incomingLocation?.accuracy === null
      ? null
      : Math.max(0, Number(incomingLocation.accuracy));
  const speedKph = normalizeSpeedKph({
    incomingLocation,
    previousPoint,
  });

  return {
    latitude: Number(incomingLocation.latitude),
    longitude: Number(incomingLocation.longitude),
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    heading:
      incomingLocation?.heading === undefined || incomingLocation?.heading === null
        ? null
        : Number(incomingLocation.heading),
    speedKph: Number.isFinite(speedKph) && speedKph >= 0 ? speedKph : 0,
    timestamp,
  };
};

const evaluateIncomingPoint = ({ previousPoint, incomingPoint }) => {
  const maxAccuracy = DRIVER_AI_THRESHOLDS.gps.maxAcceptedAccuracyMeters;

  if (
    Number.isFinite(incomingPoint.accuracy) &&
    incomingPoint.accuracy > maxAccuracy
  ) {
    return {
      accepted: false,
      reason: `ignored_poor_accuracy_${Math.round(incomingPoint.accuracy)}m`,
    };
  }

  if (!previousPoint) {
    return {
      accepted: true,
      reason: null,
    };
  }

  const elapsedSeconds = getElapsedSeconds(previousPoint, incomingPoint);

  if (
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds < DRIVER_AI_THRESHOLDS.gps.minTimeDeltaSeconds
  ) {
    return {
      accepted: false,
      reason: 'ignored_invalid_time_delta',
    };
  }

  const derivedSpeedKph = deriveSpeedKph({
    previousPoint,
    currentPoint: incomingPoint,
  });

  if (
    Number.isFinite(derivedSpeedKph) &&
    derivedSpeedKph > DRIVER_AI_THRESHOLDS.gps.maxJumpSpeedKph
  ) {
    return {
      accepted: false,
      reason: `ignored_impossible_jump_${Math.round(derivedSpeedKph)}kph`,
    };
  }

  return {
    accepted: true,
    reason: null,
  };
};

const registerConditionWindow = ({
  alertState,
  eventType,
  isConditionMet,
  pointTimestamp,
}) => {
  const currentState = alertState[eventType] ?? {
    active: false,
    startedAt: null,
    lastAlertAt: null,
  };

  if (!isConditionMet) {
    return {
      ...currentState,
      active: false,
      startedAt: null,
    };
  }

  return {
    ...currentState,
    active: true,
    startedAt: currentState.startedAt ?? pointTimestamp,
  };
};

const wasConditionSustained = ({ conditionState, pointTimestamp, minSeconds }) => {
  if (!conditionState?.startedAt) {
    return false;
  }

  const elapsedMs =
    new Date(pointTimestamp).getTime() - new Date(conditionState.startedAt).getTime();

  return elapsedMs >= minSeconds * 1000;
};

const maybePushEvent = ({ events, eventType, detectedAt, metadata }) => {
  events.push(
    buildBehaviorEvent({
      type: eventType,
      detectedAt,
      metadata,
    })
  );
};

const evaluateRapidChangeEvents = ({ recentLocations, point, events }) => {
  const recentPoints = recentLocations.filter((entry) => {
    const elapsedSeconds = getElapsedSeconds(entry, point);
    return Number.isFinite(elapsedSeconds) && elapsedSeconds <= 5;
  });

  if (!recentPoints.length) {
    return;
  }

  const referencePoint = recentPoints[0];
  const speedDelta = point.speedKph - referencePoint.speedKph;

  if (speedDelta >= DRIVER_AI_THRESHOLDS.harshAcceleration.minIncreaseKph) {
    maybePushEvent({
      events,
      eventType: DRIVER_AI_EVENT_TYPES.HARSH_ACCELERATION,
      detectedAt: point.timestamp,
      metadata: {
        speedIncreaseKph: Number(speedDelta.toFixed(2)),
        windowSeconds: getElapsedSeconds(referencePoint, point),
        severity: 'medium',
      },
    });
  }

  if (speedDelta <= -DRIVER_AI_THRESHOLDS.suddenStop.minDropKph) {
    maybePushEvent({
      events,
      eventType: DRIVER_AI_EVENT_TYPES.SUDDEN_STOP,
      detectedAt: point.timestamp,
      metadata: {
        speedDropKph: Number(Math.abs(speedDelta).toFixed(2)),
        windowSeconds: getElapsedSeconds(referencePoint, point),
        severity: 'high',
      },
    });
  }
};

const evaluateTrafficDelayCondition = ({
  allocation,
  recentLocations,
  point,
  routeProgress,
}) => {
  const rollingWindow = trimArray(
    [...recentLocations, point],
    DRIVER_AI_THRESHOLDS.trafficDelay.rollingWindowPoints
  );
  const rollingAverageSpeedKph = averageSpeedKph(rollingWindow);

  if (
    !Number.isFinite(rollingAverageSpeedKph) ||
    rollingAverageSpeedKph >
      DRIVER_AI_THRESHOLDS.trafficDelay.maxRollingAverageSpeedKph
  ) {
    return { isConditionMet: false, metadata: null };
  }

  const tripStartTime = allocation?.startTime ? new Date(allocation.startTime) : null;

  if (!tripStartTime || Number.isNaN(tripStartTime.getTime())) {
    return { isConditionMet: false, metadata: null };
  }

  const elapsedSeconds = (point.timestamp.getTime() - tripStartTime.getTime()) / 1000;

  if (elapsedSeconds < DRIVER_AI_THRESHOLDS.trafficDelay.minTripElapsedSeconds) {
    return { isConditionMet: false, metadata: null };
  }

  const estimatedDurationMinutes = Number(allocation?.estimatedDuration ?? 0);

  if (!Number.isFinite(estimatedDurationMinutes) || estimatedDurationMinutes <= 0) {
    return { isConditionMet: false, metadata: null };
  }

  const expectedProgressRatio = Math.min(
    1,
    elapsedSeconds / (estimatedDurationMinutes * 60)
  );
  const actualProgressRatio =
    Number.isFinite(routeProgress) && routeProgress >= 0 ? routeProgress : 0;

  if (
    expectedProgressRatio <
    DRIVER_AI_THRESHOLDS.trafficDelay.minExpectedProgressRatio
  ) {
    return { isConditionMet: false, metadata: null };
  }

  const progressGap = expectedProgressRatio - actualProgressRatio;

  return {
    isConditionMet:
      progressGap >= DRIVER_AI_THRESHOLDS.trafficDelay.progressDelayRatio,
    metadata: {
      rollingAverageSpeedKph: Number(rollingAverageSpeedKph.toFixed(2)),
      expectedProgressRatio: Number(expectedProgressRatio.toFixed(3)),
      actualProgressRatio: Number(actualProgressRatio.toFixed(3)),
      progressGap: Number(progressGap.toFixed(3)),
      severity: 'medium',
    },
  };
};

export const analyzeDriverBehavior = async ({ allocation, incomingLocation }) => {
  const previousAiState = allocation?.aiState ?? buildDefaultAiState();
  const recentLocations = Array.isArray(previousAiState.recentLocations)
    ? previousAiState.recentLocations
    : [];
  const previousPoint =
    recentLocations.length > 0
      ? recentLocations[recentLocations.length - 1]
      : allocation?.currentLocation ?? null;
  const analyzedPoint = buildAnalyzedPoint({
    incomingLocation,
    previousPoint,
  });
  const pointEvaluation = evaluateIncomingPoint({
    previousPoint,
    incomingPoint: analyzedPoint,
  });
  const baseAiState = {
    ...buildDefaultAiState(),
    ...previousAiState,
    alertState: {
      ...buildDefaultAlertState(),
      ...(previousAiState.alertState ?? {}),
    },
  };

  if (!pointEvaluation.accepted) {
    return {
      acceptedPoint: false,
      reason: pointEvaluation.reason,
      currentLocation: allocation?.currentLocation ?? null,
      routeProgress:
        allocation?.routeProgress === undefined ? null : allocation.routeProgress,
      aiState: {
        ...baseAiState,
        lastIgnoredPoint: {
          reason: pointEvaluation.reason,
          timestamp: analyzedPoint.timestamp,
        },
        lastAnalyzedAt: new Date(),
      },
      behaviorEvents: allocation?.behaviorEvents ?? [],
      aiAlerts: allocation?.aiAlerts ?? [],
      driverScore: allocation?.driverScore ?? calculateDriverScore([]),
      createdEvents: [],
      createdAlerts: [],
    };
  }

  const routePoints = getRoutePoints(allocation);
  const routeProgress = computeRouteProgress({
    point: analyzedPoint,
    routePoints,
  });
  const distanceFromRouteMeters = distanceToPolylineMeters(analyzedPoint, routePoints);
  const nextRecentLocations = trimArray(
    [...recentLocations, analyzedPoint],
    DRIVER_AI_THRESHOLDS.analysis.maxRecentPoints
  );
  const nextAlertState = {
    ...baseAiState.alertState,
  };
  const createdEvents = [];
  const createdAlerts = [];

  evaluateRapidChangeEvents({
    recentLocations,
    point: analyzedPoint,
    events: createdEvents,
  });

  nextAlertState[DRIVER_AI_EVENT_TYPES.OVERSPEEDING] = registerConditionWindow({
    alertState: nextAlertState,
    eventType: DRIVER_AI_EVENT_TYPES.OVERSPEEDING,
    isConditionMet:
      analyzedPoint.speedKph >= DRIVER_AI_THRESHOLDS.overspeeding.minSpeedKph,
    pointTimestamp: analyzedPoint.timestamp,
  });

  if (
    nextAlertState[DRIVER_AI_EVENT_TYPES.OVERSPEEDING].active &&
    wasConditionSustained({
      conditionState: nextAlertState[DRIVER_AI_EVENT_TYPES.OVERSPEEDING],
      pointTimestamp: analyzedPoint.timestamp,
      minSeconds: DRIVER_AI_THRESHOLDS.overspeeding.sustainedForSeconds,
    }) &&
    shouldCreateAlert({
      alertState: nextAlertState,
      eventType: DRIVER_AI_EVENT_TYPES.OVERSPEEDING,
      detectedAt: analyzedPoint.timestamp,
    })
  ) {
    maybePushEvent({
      events: createdEvents,
      eventType: DRIVER_AI_EVENT_TYPES.OVERSPEEDING,
      detectedAt: analyzedPoint.timestamp,
      metadata: {
        speedKph: Number(analyzedPoint.speedKph.toFixed(2)),
        sustainedForSeconds:
          DRIVER_AI_THRESHOLDS.overspeeding.sustainedForSeconds,
        severity: 'high',
      },
    });
  }

  nextAlertState[DRIVER_AI_EVENT_TYPES.ROUTE_DEVIATION] = registerConditionWindow({
    alertState: nextAlertState,
    eventType: DRIVER_AI_EVENT_TYPES.ROUTE_DEVIATION,
    isConditionMet:
      Number.isFinite(distanceFromRouteMeters) &&
      distanceFromRouteMeters >
        DRIVER_AI_THRESHOLDS.routeDeviation.minDistanceMeters,
    pointTimestamp: analyzedPoint.timestamp,
  });

  if (
    nextAlertState[DRIVER_AI_EVENT_TYPES.ROUTE_DEVIATION].active &&
    wasConditionSustained({
      conditionState: nextAlertState[DRIVER_AI_EVENT_TYPES.ROUTE_DEVIATION],
      pointTimestamp: analyzedPoint.timestamp,
      minSeconds: DRIVER_AI_THRESHOLDS.routeDeviation.sustainedForSeconds,
    }) &&
    shouldCreateAlert({
      alertState: nextAlertState,
      eventType: DRIVER_AI_EVENT_TYPES.ROUTE_DEVIATION,
      detectedAt: analyzedPoint.timestamp,
    })
  ) {
    maybePushEvent({
      events: createdEvents,
      eventType: DRIVER_AI_EVENT_TYPES.ROUTE_DEVIATION,
      detectedAt: analyzedPoint.timestamp,
      metadata: {
        distanceFromRouteMeters: Number(distanceFromRouteMeters.toFixed(2)),
        routeProgress:
          Number.isFinite(routeProgress) && routeProgress >= 0
            ? Number(routeProgress.toFixed(3))
            : null,
        severity: 'high',
      },
    });
  }

  nextAlertState[DRIVER_AI_EVENT_TYPES.LONG_IDLE] = registerConditionWindow({
    alertState: nextAlertState,
    eventType: DRIVER_AI_EVENT_TYPES.LONG_IDLE,
    isConditionMet:
      analyzedPoint.speedKph <= DRIVER_AI_THRESHOLDS.longIdle.maxSpeedKph,
    pointTimestamp: analyzedPoint.timestamp,
  });

  if (
    nextAlertState[DRIVER_AI_EVENT_TYPES.LONG_IDLE].active &&
    wasConditionSustained({
      conditionState: nextAlertState[DRIVER_AI_EVENT_TYPES.LONG_IDLE],
      pointTimestamp: analyzedPoint.timestamp,
      minSeconds: DRIVER_AI_THRESHOLDS.longIdle.sustainedForSeconds,
    }) &&
    shouldCreateAlert({
      alertState: nextAlertState,
      eventType: DRIVER_AI_EVENT_TYPES.LONG_IDLE,
      detectedAt: analyzedPoint.timestamp,
    })
  ) {
    const idleSeconds =
      (analyzedPoint.timestamp.getTime() -
        new Date(
          nextAlertState[DRIVER_AI_EVENT_TYPES.LONG_IDLE].startedAt
        ).getTime()) /
      1000;

    maybePushEvent({
      events: createdEvents,
      eventType: DRIVER_AI_EVENT_TYPES.LONG_IDLE,
      detectedAt: analyzedPoint.timestamp,
      metadata: {
        idleSeconds: Number(idleSeconds.toFixed(1)),
        severity: 'medium',
      },
    });
  }

  const trafficCondition = evaluateTrafficDelayCondition({
    allocation,
    recentLocations,
    point: analyzedPoint,
    routeProgress,
  });

  nextAlertState[DRIVER_AI_EVENT_TYPES.POSSIBLE_TRAFFIC_DELAY] =
    registerConditionWindow({
      alertState: nextAlertState,
      eventType: DRIVER_AI_EVENT_TYPES.POSSIBLE_TRAFFIC_DELAY,
      isConditionMet: trafficCondition.isConditionMet,
      pointTimestamp: analyzedPoint.timestamp,
    });

  if (
    nextAlertState[DRIVER_AI_EVENT_TYPES.POSSIBLE_TRAFFIC_DELAY].active &&
    shouldCreateAlert({
      alertState: nextAlertState,
      eventType: DRIVER_AI_EVENT_TYPES.POSSIBLE_TRAFFIC_DELAY,
      detectedAt: analyzedPoint.timestamp,
    })
  ) {
    maybePushEvent({
      events: createdEvents,
      eventType: DRIVER_AI_EVENT_TYPES.POSSIBLE_TRAFFIC_DELAY,
      detectedAt: analyzedPoint.timestamp,
      metadata: trafficCondition.metadata ?? {
        severity: 'medium',
      },
    });
  }

  const eventHistory = trimArray(
    [...(allocation?.behaviorEvents ?? []), ...createdEvents],
    DRIVER_AI_THRESHOLDS.analysis.maxBehaviorEvents
  );
  const nextAlerts = [...(allocation?.aiAlerts ?? [])];

  for (const event of createdEvents) {
    if (
      !shouldCreateAlert({
        alertState: nextAlertState,
        eventType: event.type,
        detectedAt: event.detectedAt,
      })
    ) {
      continue;
    }

    const createdAlert = await createDriverBehaviorAlert({
      allocation,
      eventType: event.type,
      detectedAt: event.detectedAt,
      metadata: event.metadata,
    });

    createdAlerts.push(createdAlert);
    nextAlerts.push(createdAlert);
    nextAlertState[event.type] = {
      ...(nextAlertState[event.type] ?? {
        active: false,
        startedAt: null,
      }),
      lastAlertAt: event.detectedAt,
    };
  }

  const driverScore = calculateDriverScore(eventHistory);

  return {
    acceptedPoint: true,
    reason: null,
    currentLocation: {
      latitude: analyzedPoint.latitude,
      longitude: analyzedPoint.longitude,
      accuracy: analyzedPoint.accuracy,
      speed: analyzedPoint.speedKph,
      heading: analyzedPoint.heading,
      timestamp: analyzedPoint.timestamp,
      updatedAt: analyzedPoint.timestamp,
    },
    routeProgress:
      Number.isFinite(routeProgress) && routeProgress >= 0
        ? Number(routeProgress.toFixed(4))
        : allocation?.routeProgress ?? null,
    aiState: {
      ...baseAiState,
      recentLocations: nextRecentLocations,
      alertState: nextAlertState,
      lastIgnoredPoint: null,
      lastAnalyzedAt: new Date(),
      lastAcceptedPointAt: analyzedPoint.timestamp,
      latestRouteDistanceMeters: Number.isFinite(distanceFromRouteMeters)
        ? Number(distanceFromRouteMeters.toFixed(2))
        : null,
    },
    behaviorEvents: eventHistory,
    aiAlerts: trimArray(
      nextAlerts,
      DRIVER_AI_THRESHOLDS.analysis.maxAlertHistory
    ),
    driverScore,
    createdEvents,
    createdAlerts,
    diagnostics: {
      speedKph: Number(analyzedPoint.speedKph.toFixed(2)),
      distanceFromRouteMeters: Number.isFinite(distanceFromRouteMeters)
        ? Number(distanceFromRouteMeters.toFixed(2))
        : null,
      segmentDistanceMeters: previousPoint
        ? Number(
            haversineDistanceMeters(previousPoint, analyzedPoint).toFixed(2)
          )
        : 0,
    },
  };
};
