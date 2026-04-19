import mongoose from 'mongoose';

import { baseSchemaOptions } from '../utils/schemaOptions.js';

const preparationEtaArtifactSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    source: {
      type: String,
      default: 'model',
      trim: true,
    },
    trainedRecords: {
      type: Number,
      default: 0,
      min: 0,
    },
    modelBundle: {
      blobBase64: {
        type: String,
        default: null,
      },
      metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
    },
  },
  baseSchemaOptions
);

export const PreparationEtaArtifact =
  mongoose.models.PreparationEtaArtifact ||
  mongoose.model('PreparationEtaArtifact', preparationEtaArtifactSchema);
