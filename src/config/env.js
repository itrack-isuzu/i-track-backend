import dotenv from 'dotenv';

dotenv.config();

const trueValues = new Set(['1', 'true', 'yes', 'on']);

const toBoolean = (value, fallback = false) => {
  if (value === undefined) {
    return fallback;
  }

  return trueValues.has(String(value).trim().toLowerCase());
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
};
