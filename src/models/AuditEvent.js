import mongoose from 'mongoose';
import { baseSchemaOptions } from '../utils/schemaOptions.js';

const schema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  user: { type: String, required: true },
  userEmail: String,
  role: { type: String, required: true },
  action: { type: String, required: true, index: true },
  module: { type: String, required: true },
  entityId: { type: String, default: '' },
  description: { type: String, required: true },
  reason: { type: String, default: '' },
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  outcome: { type: String, enum: ['pending', 'succeeded', 'failed'], default: 'pending', index: true },
}, baseSchemaOptions);
schema.index({ createdAt: -1 });
export const AuditEvent = mongoose.models.AuditEvent || mongoose.model('AuditEvent', schema);
