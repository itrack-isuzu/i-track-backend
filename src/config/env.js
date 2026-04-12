import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..', '..', '..');

const loadEnvFile = (relativePath) => {
  const absolutePath = path.resolve(workspaceRoot, relativePath);

  if (!fs.existsSync(absolutePath)) {
    return {};
  }

  try {
    return dotenv.parse(fs.readFileSync(absolutePath));
  } catch {
    return {};
  }
};

const frontendEnv = loadEnvFile('frontend/.env');
const webFrontendLocalEnv = loadEnvFile('web-frontend/.env.local');
const webFrontendEnv = loadEnvFile('web-frontend/.env');

const getFallbackEnvValue = (key) => {
  const runtimeValue = process.env[key];

  if (runtimeValue !== undefined && String(runtimeValue).trim() !== '') {
    return runtimeValue;
  }

  const frontendValue = frontendEnv[key];
  if (frontendValue !== undefined && String(frontendValue).trim() !== '') {
    return frontendValue;
  }

  const webFrontendLocalValue = webFrontendLocalEnv[key];
  if (
    webFrontendLocalValue !== undefined &&
    String(webFrontendLocalValue).trim() !== ''
  ) {
    return webFrontendLocalValue;
  }

  const webFrontendValue = webFrontendEnv[key];
  if (webFrontendValue !== undefined && String(webFrontendValue).trim() !== '') {
    return webFrontendValue;
  }

  return undefined;
};

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

const normalizeSmsProvider = (value) => {
  const normalizedValue = toOptionalString(value)?.toLowerCase();

  if (!normalizedValue) {
    return undefined;
  }

  if (normalizedValue.startsWith('fortmed')) {
    return 'fortmed';
  }

  if (normalizedValue.startsWith('fmcsms')) {
    return 'fmcsms';
  }

  if (normalizedValue.startsWith('twilio')) {
    return 'twilio';
  }

  return normalizedValue;
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
  emailjsUserWelcomeTemplateId: toOptionalString(
    process.env.EMAILJS_USER_WELCOME_TEMPLATE_ID
  ),
  emailjsPublicKey: toOptionalString(process.env.EMAILJS_PUBLIC_KEY),
  emailjsPrivateKey: toOptionalString(process.env.EMAILJS_PRIVATE_KEY),
  emailjsAppName: process.env.EMAILJS_APP_NAME?.trim() || 'I-TRACK',
  emailjsSupportEmail: toOptionalString(process.env.EMAILJS_SUPPORT_EMAIL),
  expoAccessToken: toOptionalString(process.env.EXPO_ACCESS_TOKEN),
  smsEnabled: toBoolean(getFallbackEnvValue('SMS_ENABLED'), true),
  smsProvider:
    normalizeSmsProvider(getFallbackEnvValue('SMS_PROVIDER')) ??
    (getFallbackEnvValue('FORTMED_API_URL') ||
    getFallbackEnvValue('SMS_API_URL') ||
    getFallbackEnvValue('FORTMED_API_KEY') ||
    getFallbackEnvValue('SMS_API_KEY')
      ? 'fortmed'
      :
    (getFallbackEnvValue('FMCSMS_USERNAME') ||
    getFallbackEnvValue('FMCSMS_PASSWORD') ||
    getFallbackEnvValue('FMCSMS_API_KEY')
      ? 'fmcsms'
      : 'twilio')),
  fortmedApiUrl:
    toOptionalString(
      getFallbackEnvValue('FORTMED_API_URL') ?? getFallbackEnvValue('SMS_API_URL')
    ) ??
    'https://fortmed.org/web/FMCSMS/api/messages.php',
  fortmedApiKey: toOptionalString(
    getFallbackEnvValue('FORTMED_API_KEY') ?? getFallbackEnvValue('SMS_API_KEY')
  ),
  fortmedSenderId: toOptionalString(
    getFallbackEnvValue('FORTMED_SENDER_ID') ??
      getFallbackEnvValue('SMS_SENDER_ID')
  ),
  fortmedFromNumber: toOptionalString(
    getFallbackEnvValue('FORTMED_FROM_NUMBER') ??
      getFallbackEnvValue('SMS_FROM_NUMBER')
  ),
  fmcsmsApiUrl:
    toOptionalString(getFallbackEnvValue('FMCSMS_API_URL')) ??
    'http://www.ciedco-sms.net/api/sendsms.php',
  fmcsmsUsername: toOptionalString(
    getFallbackEnvValue('FMCSMS_USERNAME') ??
      getFallbackEnvValue('FMCSMS_API_USERNAME')
  ),
  fmcsmsPassword: toOptionalString(
    getFallbackEnvValue('FMCSMS_PASSWORD') ??
      getFallbackEnvValue('FMCSMS_API_KEY')
  ),
  fmcsmsSenderId: toOptionalString(
    getFallbackEnvValue('FMCSMS_SENDER_ID') ??
      getFallbackEnvValue('FMCSMS_SENDER')
  ),
  twilioAccountSid: toOptionalString(getFallbackEnvValue('TWILIO_ACCOUNT_SID')),
  twilioAuthToken: toOptionalString(getFallbackEnvValue('TWILIO_AUTH_TOKEN')),
  twilioMessagingServiceSid: toOptionalString(
    getFallbackEnvValue('TWILIO_MESSAGING_SERVICE_SID')
  ),
  twilioFromNumber: toOptionalString(getFallbackEnvValue('TWILIO_FROM_NUMBER')),
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
