import { AuthSession } from '../models/AuthSession.js';
import { asyncHandler } from '../utils/asyncHandler.js';
const publicPaths = new Set(['/health', '/auth/login', '/auth/forgot-password/request-otp', '/auth/forgot-password/verify-otp', '/auth/forgot-password/reset']);
export const accountAccess = asyncHandler(async (req, res, next) => {
  if (publicPaths.has(req.path)) return next();
  const token = req.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const session = token ? await AuthSession.findOne({ token, expiresAt: { $gt: new Date() } }).populate('userId') : null;
  const user = session?.userId;
  if (!user?.isActive) return res.status(401).json({ success: false, message: 'Please sign in again.' });
  req.authUser = user;
  req.authToken = token;
  if (user.mustChangePassword && !['/auth/change-password', '/auth/logout', '/auth/me'].includes(req.path)) {
    return res.status(403).json({ success: false, code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your password before accessing the system.' });
  }
  next();
});
