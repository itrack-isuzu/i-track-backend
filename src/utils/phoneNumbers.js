export const PHONE_NUMBER_VALIDATION_MESSAGE =
  'Phone number must be 11 digits and start with 09.';

const MOBILE_PHONE_PATTERN = /^09\d{9}$/;

export const normalizePhoneNumber = (value) =>
  String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 11);

export const isValidPhoneNumber = (value) =>
  MOBILE_PHONE_PATTERN.test(String(value ?? '').trim());

export const ensureValidPhoneNumber = (
  value,
  label = 'Phone number'
) => {
  const normalizedPhoneNumber = normalizePhoneNumber(value);

  if (!MOBILE_PHONE_PATTERN.test(normalizedPhoneNumber)) {
    const error = new Error(`${label} must be 11 digits and start with 09.`);
    error.statusCode = 400;
    throw error;
  }

  return normalizedPhoneNumber;
};

export const ensureUniquePhoneNumber = async ({
  model,
  field,
  value,
  excludeId,
  label = 'Phone number',
}) => {
  const duplicateRecord = await model
    .findOne({
      [field]: value,
      ...(excludeId
        ? {
            _id: {
              $ne: excludeId,
            },
          }
        : {}),
    })
    .select('_id');

  if (!duplicateRecord) {
    return;
  }

  const error = new Error(`${label} already exists.`);
  error.statusCode = 409;
  throw error;
};
