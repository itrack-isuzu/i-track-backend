const invalidInput = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

export const parseFiniteNumber = (value, label) => {
  if (
    !['number', 'string'].includes(typeof value) ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    throw invalidInput(`${label} must be a finite number.`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw invalidInput(`${label} must be a finite number.`);
  }
  return parsed;
};

export const parseCoordinates = (value, label = 'Location') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidInput(`${label} must contain latitude and longitude.`);
  }
  const latitude = parseFiniteNumber(value.latitude, `${label} latitude`);
  const longitude = parseFiniteNumber(value.longitude, `${label} longitude`);
  if (latitude < -90 || latitude > 90) {
    throw invalidInput(`${label} latitude must be between -90 and 90.`);
  }
  if (longitude < -180 || longitude > 180) {
    throw invalidInput(`${label} longitude must be between -180 and 180.`);
  }
  return { latitude, longitude };
};

export const buildLiteralSearchPattern = (value, maxLength = 200) => {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw invalidInput(`Search must be text of at most ${maxLength} characters.`);
  }
  const search = value.trim();
  if (!search) return null;
  return new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
};

export const validateEnumInput = (value, allowedValues, label) => {
  if (typeof value !== 'string' || !allowedValues.includes(value)) {
    throw invalidInput(`${label} must be one of: ${allowedValues.join(', ')}.`);
  }
  return value;
};

export const validateVehiclePayload = (payload, { partial = false, statuses, existingConductionNumber }) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidInput('Vehicle details must be an object.');
  }
  const next = {};
  const requiredFields = ['unitName', 'variation', 'conductionNumber', 'bodyColor'];
  const textFields = [...requiredFields, 'notes', 'imageUrl'];
  const allowedFields = new Set([...textFields, 'status', 'location']);
  if (Object.keys(payload).some((field) => !allowedFields.has(field))) {
    throw invalidInput('Vehicle details contain an unsupported field.');
  }
  for (const field of textFields) {
    if (!Object.hasOwn(payload, field)) {
      if (!partial && requiredFields.includes(field)) {
        throw invalidInput(`${field} is required.`);
      }
      continue;
    }
    if (field === 'imageUrl' && payload[field] === null) {
      next[field] = null;
      continue;
    }
    if (typeof payload[field] !== 'string') {
      throw invalidInput(`${field} must be text.`);
    }
    const value = payload[field].trim();
    if (partial && field === 'conductionNumber' &&
        value.toUpperCase() === String(existingConductionNumber ?? '').trim().toUpperCase()) {
      // Clients submit whole forms. Do not rewrite or revalidate an unchanged
      // legacy identifier while the user is editing another stock field.
      continue;
    }
    if (requiredFields.includes(field) && !value) {
      throw invalidInput(`${field} is required.`);
    }
    next[field] = field === 'conductionNumber' ? value.toUpperCase() : value;
  }
  if (next.conductionNumber !== undefined && !/^[A-Z0-9]{6,7}$/.test(next.conductionNumber)) {
    throw invalidInput('Conduction number must contain 6 to 7 letters or digits.');
  }
  if (Object.hasOwn(payload, 'status')) {
    next.status = validateEnumInput(payload.status, statuses, 'Vehicle status');
  }
  if (Object.hasOwn(payload, 'location')) {
    next.location = payload.location === null ? null : parseCoordinates(payload.location, 'Vehicle location');
  }
  if (partial && Object.keys(payload).length === 0) {
    throw invalidInput('Provide at least one vehicle field to update.');
  }
  return next;
};
