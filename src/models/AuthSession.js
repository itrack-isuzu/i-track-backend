import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 86400000), index: { expires: 0 } },
});
export const AuthSession = mongoose.models.AuthSession || mongoose.model('AuthSession', schema);
