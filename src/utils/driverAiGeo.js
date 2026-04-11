const EARTH_RADIUS_METERS = 6371000;

const toRadians = (value) => (value * Math.PI) / 180;

export const toPoint = (value) => {
  if (!value) return null;

  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
};

export const haversineDistanceMeters = (from, to) => {
  const left = toPoint(from);
  const right = toPoint(to);

  if (!left || !right) {
    return 0;
  }

  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const getElapsedSeconds = (previousPoint, currentPoint) => {
  if (!previousPoint || !currentPoint) return null;

  const start = new Date(
    previousPoint.timestamp ?? previousPoint.updatedAt ?? Date.now()
  ).getTime();
  const end = new Date(
    currentPoint.timestamp ?? currentPoint.updatedAt ?? Date.now()
  ).getTime();
  const elapsedSeconds = (end - start) / 1000;

  return Number.isFinite(elapsedSeconds) ? elapsedSeconds : null;
};

export const deriveSpeedKph = ({ previousPoint, currentPoint }) => {
  const elapsedSeconds = getElapsedSeconds(previousPoint, currentPoint);

  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return null;
  }

  const distanceMeters = haversineDistanceMeters(previousPoint, currentPoint);
  return (distanceMeters / elapsedSeconds) * 3.6;
};

const projectPointMeters = (point, referenceLatitude) => {
  const latitude = toRadians(point.latitude);
  const longitude = toRadians(point.longitude);
  const adjustedEarthRadius = EARTH_RADIUS_METERS * Math.cos(referenceLatitude);

  return {
    x: longitude * adjustedEarthRadius,
    y: latitude * EARTH_RADIUS_METERS,
  };
};

export const distancePointToSegmentMeters = (point, segmentStart, segmentEnd) => {
  const source = toPoint(point);
  const start = toPoint(segmentStart);
  const end = toPoint(segmentEnd);

  if (!source || !start || !end) return Infinity;

  if (start.latitude === end.latitude && start.longitude === end.longitude) {
    return haversineDistanceMeters(source, start);
  }

  const referenceLatitude = toRadians(
    (source.latitude + start.latitude + end.latitude) / 3
  );
  const projectedSource = projectPointMeters(source, referenceLatitude);
  const projectedStart = projectPointMeters(start, referenceLatitude);
  const projectedEnd = projectPointMeters(end, referenceLatitude);
  const dx = projectedEnd.x - projectedStart.x;
  const dy = projectedEnd.y - projectedStart.y;
  const denominator = dx ** 2 + dy ** 2;

  if (denominator === 0) {
    return Math.hypot(
      projectedSource.x - projectedStart.x,
      projectedSource.y - projectedStart.y
    );
  }

  const projection =
    ((projectedSource.x - projectedStart.x) * dx +
      (projectedSource.y - projectedStart.y) * dy) /
    denominator;
  const clampedProjection = Math.max(0, Math.min(1, projection));
  const nearestPoint = {
    x: projectedStart.x + dx * clampedProjection,
    y: projectedStart.y + dy * clampedProjection,
  };

  return Math.hypot(
    projectedSource.x - nearestPoint.x,
    projectedSource.y - nearestPoint.y
  );
};

export const distanceToPolylineMeters = (point, routePoints = []) => {
  if (!Array.isArray(routePoints) || routePoints.length === 0) return Infinity;
  if (routePoints.length === 1) return haversineDistanceMeters(point, routePoints[0]);

  let shortestDistance = Infinity;

  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const distance = distancePointToSegmentMeters(
      point,
      routePoints[index],
      routePoints[index + 1]
    );

    if (distance < shortestDistance) {
      shortestDistance = distance;
    }
  }

  return shortestDistance;
};

export const averageSpeedKph = (points = []) => {
  const speeds = points
    .map((point) => Number(point?.speedKph))
    .filter((value) => Number.isFinite(value) && value >= 0);

  if (!speeds.length) return null;

  return speeds.reduce((sum, value) => sum + value, 0) / speeds.length;
};

export const computeRouteProgress = ({ point, routePoints = [] }) => {
  const currentPoint = toPoint(point);

  if (!currentPoint || routePoints.length < 2) return null;

  let totalDistance = 0;
  const segmentLengths = [];

  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const length = haversineDistanceMeters(routePoints[index], routePoints[index + 1]);
    segmentLengths.push(length);
    totalDistance += length;
  }

  if (totalDistance <= 0) return null;

  let bestDistance = Infinity;
  let bestProgressMeters = 0;
  let travelledDistance = 0;

  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const start = toPoint(routePoints[index]);
    const end = toPoint(routePoints[index + 1]);

    if (!start || !end) {
      travelledDistance += segmentLengths[index] ?? 0;
      continue;
    }

    const referenceLatitude = toRadians(
      (currentPoint.latitude + start.latitude + end.latitude) / 3
    );
    const projectedPoint = projectPointMeters(currentPoint, referenceLatitude);
    const projectedStart = projectPointMeters(start, referenceLatitude);
    const projectedEnd = projectPointMeters(end, referenceLatitude);
    const dx = projectedEnd.x - projectedStart.x;
    const dy = projectedEnd.y - projectedStart.y;
    const denominator = dx ** 2 + dy ** 2;
    const rawProjection =
      denominator === 0
        ? 0
        : ((projectedPoint.x - projectedStart.x) * dx +
            (projectedPoint.y - projectedStart.y) * dy) /
          denominator;
    const clampedProjection = Math.max(0, Math.min(1, rawProjection));
    const nearestPoint = {
      x: projectedStart.x + dx * clampedProjection,
      y: projectedStart.y + dy * clampedProjection,
    };
    const distance = Math.hypot(
      projectedPoint.x - nearestPoint.x,
      projectedPoint.y - nearestPoint.y
    );

    if (distance < bestDistance) {
      bestDistance = distance;
      bestProgressMeters =
        travelledDistance + (segmentLengths[index] ?? 0) * clampedProjection;
    }

    travelledDistance += segmentLengths[index] ?? 0;
  }

  return Math.max(0, Math.min(1, bestProgressMeters / totalDistance));
};
