export const DRIVER_AI_EVENT_TYPES = {
  OVERSPEEDING: 'overspeeding',
  SUDDEN_STOP: 'sudden_stop',
  HARSH_ACCELERATION: 'harsh_acceleration',
  ROUTE_DEVIATION: 'route_deviation',
  LONG_IDLE: 'long_idle',
  POSSIBLE_TRAFFIC_DELAY: 'possible_traffic_delay',
};

export const DRIVER_AI_THRESHOLDS = {
  gps: {
    maxAcceptedAccuracyMeters: 35,
    maxJumpSpeedKph: 180,
    minTimeDeltaSeconds: 1,
  },
  overspeeding: {
    minSpeedKph: 60,
    sustainedForSeconds: 10,
    cooldownSeconds: 120,
  },
  suddenStop: {
    minDropKph: 25,
    withinSeconds: 5,
    cooldownSeconds: 60,
  },
  harshAcceleration: {
    minIncreaseKph: 20,
    withinSeconds: 5,
    cooldownSeconds: 60,
  },
  routeDeviation: {
    minDistanceMeters: 150,
    sustainedForSeconds: 20,
    cooldownSeconds: 180,
  },
  longIdle: {
    maxSpeedKph: 3,
    sustainedForSeconds: 180,
    cooldownSeconds: 300,
  },
  trafficDelay: {
    rollingWindowPoints: 6,
    maxRollingAverageSpeedKph: 12,
    minTripElapsedSeconds: 300,
    minExpectedProgressRatio: 0.2,
    progressDelayRatio: 0.25,
    cooldownSeconds: 300,
  },
  analysis: {
    maxRecentPoints: 60,
    maxBehaviorEvents: 100,
    maxAlertHistory: 50,
  },
};

export const DRIVER_AI_SCORING = {
  startingScore: 100,
  deductions: {
    overspeeding: 12,
    sudden_stop: 10,
    harsh_acceleration: 8,
    route_deviation: 15,
    long_idle: 6,
    possible_traffic_delay: 5,
  },
  ratings: [
    { minScore: 90, label: 'Excellent' },
    { minScore: 75, label: 'Good' },
    { minScore: 60, label: 'Fair' },
    { minScore: 0, label: 'Risky' },
  ],
};

export const DRIVER_AI_ALERT_SEVERITY = {
  overspeeding: 'high',
  sudden_stop: 'high',
  harsh_acceleration: 'medium',
  route_deviation: 'high',
  long_idle: 'medium',
  possible_traffic_delay: 'medium',
};
