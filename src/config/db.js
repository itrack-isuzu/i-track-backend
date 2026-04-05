import mongoose from 'mongoose';

import { env } from './env.js';

mongoose.set('strictQuery', true);

export const connectDatabase = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  await mongoose.connect(env.mongodbUri, {
    dbName: env.mongodbDbName,
  });

  return mongoose.connection;
};

export const ensureCollections = async (models) => {
  if (!env.autoCreateCollections) {
    return [];
  }

  const ensuredCollections = [];

  for (const model of models) {
    try {
      await model.createCollection();
      ensuredCollections.push(model.collection.collectionName);
    } catch (error) {
      if (error?.codeName !== 'NamespaceExists') {
        throw error;
      }
    }
  }

  return ensuredCollections;
};
