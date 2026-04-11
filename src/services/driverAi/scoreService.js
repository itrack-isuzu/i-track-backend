import {
  DRIVER_AI_EVENT_TYPES,
  DRIVER_AI_SCORING,
} from '../../config/driverAiConfig.js';

const EVENT_TYPE_LIST = Object.values(DRIVER_AI_EVENT_TYPES);

const buildEmptyCounts = () =>
  EVENT_TYPE_LIST.reduce((accumulator, eventType) => {
    accumulator[eventType] = 0;
    return accumulator;
  }, {});

export const calculateDriverScore = (behaviorEvents = []) => {
  const eventCounts = buildEmptyCounts();
  let totalDeductions = 0;

  behaviorEvents.forEach((event) => {
    const eventType = String(event?.type ?? '').trim();

    if (!Object.prototype.hasOwnProperty.call(eventCounts, eventType)) {
      return;
    }

    eventCounts[eventType] += 1;
    totalDeductions += DRIVER_AI_SCORING.deductions[eventType] ?? 0;
  });

  const score = Math.max(0, DRIVER_AI_SCORING.startingScore - totalDeductions);
  const rating =
    DRIVER_AI_SCORING.ratings.find((entry) => score >= entry.minScore)?.label ??
    'Risky';

  return {
    score,
    rating,
    totalDeductions,
    eventCounts,
    updatedAt: new Date(),
  };
};
