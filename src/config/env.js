import dotenv from 'dotenv';

dotenv.config();

const trueValues = new Set(['1', 'true', 'yes', 'on']);

const toOptionalString = (value) => {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue ? normalizedValue : undefined;
};

const toBoolean = (value, fallback = false) => {
  if (value === undefined) {
    return fallback;
  }

  return trueValues.has(String(value).trim().toLowerCase());
};

const toNumber = (value, fallback) => {
  if (value === undefined) {
    return fallback;
  }

  const normalizedValue = Number(value);
  return Number.isFinite(normalizedValue) ? normalizedValue : fallback;
};

const requireEnv = (value, key) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  mongodbUri: requireEnv(process.env.MONGODB_URI, 'MONGODB_URI'),
  mongodbDbName: process.env.MONGODB_DB_NAME ?? undefined,
  clientOrigin: process.env.CLIENT_ORIGIN ?? '*',
  autoCreateCollections: toBoolean(
    process.env.MONGODB_AUTO_CREATE_COLLECTIONS,
    true
  ),
  autoSeed: toBoolean(process.env.MONGODB_AUTO_SEED, false),
  emailjsServiceId: toOptionalString(process.env.EMAILJS_SERVICE_ID),
  emailjsTemplateId: toOptionalString(process.env.EMAILJS_TEMPLATE_ID),
  emailjsPublicKey: toOptionalString(process.env.EMAILJS_PUBLIC_KEY),
  emailjsPrivateKey: toOptionalString(process.env.EMAILJS_PRIVATE_KEY),
  emailjsAppName: process.env.EMAILJS_APP_NAME?.trim() || 'I-TRACK',
  emailjsSupportEmail: toOptionalString(process.env.EMAILJS_SUPPORT_EMAIL),
  expoAccessToken: toOptionalString(process.env.EXPO_ACCESS_TOKEN),
  passwordResetOtpExpiresMinutes: toNumber(
    process.env.PASSWORD_RESET_OTP_EXPIRES_MINUTES,
    10
  ),
  passwordResetOtpCooldownSeconds: toNumber(
    process.env.PASSWORD_RESET_OTP_COOLDOWN_SECONDS,
    60
  ),
  passwordResetOtpMaxAttempts: toNumber(
    process.env.PASSWORD_RESET_OTP_MAX_ATTEMPTS,
    5
  ),
};
