import { randomUUID } from 'node:crypto';

import { User } from '../models/User.js';
import { AuthEvent } from '../models/AuthEvent.js';
import { sendPasswordResetOtpEmail } from '../services/emailjsService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  OTP_CODE_LENGTH,
  createOtpCode,
  hashOtpCode,
  normalizeOtpCode,
  verifyOtpCode,
} from '../utils/otp.js';
import { verifyPassword, hashPassword } from '../utils/passwords.js';
import { env } from '../config/env.js';

const PASSWORD_RESET_REQUEST_MESSAGE =
  'A 6-digit OTP code has been sent to your registered email address.';
const PASSWORD_RESET_EMAIL_VALIDATION_MESSAGE =
  'Enter an active registered email address.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createHttpError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();
const toOptionalString = (value) => {
  const normalizedValue = String(value ?? '').trim();
  return normalizedValue || null;
};

const getFullName = (user) =>
  `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim();

const toAuthEventPayload = ({
  userId,
  name,
  email,
  role,
  eventType,
}) => {
  const resolvedName = toOptionalString(name);
  const resolvedEmail = toOptionalString(email);

  if (!resolvedName || !resolvedEmail) {
    return null;
  }

  return {
    userId: userId ?? null,
    name: resolvedName,
    email: normalizeEmail(resolvedEmail),
    role: toOptionalString(role),
    eventType,
  };
};

const logAuthEvent = async ({ userId, name, email, role, eventType }) => {
  const payload = toAuthEventPayload({
    userId,
    name,
    email,
    role,
    eventType,
  });

  if (!payload) {
    return null;
  }

  return AuthEvent.create(payload);
};

const logAuthEventSafely = async (payload) => {
  try {
    return await logAuthEvent(payload);
  } catch (error) {
    console.warn(
      `[auth-events] Unable to store ${payload?.eventType ?? 'auth'} event:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
};

const ensureValidEmail = (email) => {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) {
    throw createHttpError('Enter a valid email address.');
  }

  return normalizedEmail;
};

const ensureValidOtpCode = (otpCode) => {
  const normalizedOtpCode = normalizeOtpCode(otpCode);

  if (normalizedOtpCode.length !== OTP_CODE_LENGTH) {
    throw createHttpError(`Enter the ${OTP_CODE_LENGTH}-digit OTP code.`);
  }

  return normalizedOtpCode;
};

const findAuthUserByEmail = async (
  email,
  { includePasswordHash = false, includePasswordReset = false } = {}
) => {
  const selectedFields = [
    includePasswordHash ? '+passwordHash' : null,
    includePasswordReset ? '+passwordReset' : null,
  ]
    .filter(Boolean)
    .join(' ');

  const query = User.findOne({
    email: normalizeEmail(email),
  });

  return selectedFields ? query.select(selectedFields) : query;
};

const clearPasswordResetState = (user) => {
  user.passwordReset = undefined;
};

const validatePasswordResetOtp = async ({
  email,
  otpCode,
  includePasswordHash = false,
}) => {
  const user = await findAuthUserByEmail(email, {
    includePasswordHash,
    includePasswordReset: true,
  });

  if (!user || !user.isActive) {
    throw createHttpError('Invalid or expired OTP code.');
  }

  const passwordResetState = user.passwordReset;

  if (!passwordResetState?.otpHash || !passwordResetState?.expiresAt) {
    throw createHttpError('Invalid or expired OTP code.');
  }

  if (passwordResetState.expiresAt.getTime() < Date.now()) {
    clearPasswordResetState(user);
    await user.save();
    throw createHttpError('This OTP code has expired. Request a new code.');
  }

  if ((passwordResetState.attempts ?? 0) >= env.passwordResetOtpMaxAttempts) {
    clearPasswordResetState(user);
    await user.save();
    throw createHttpError('Too many OTP attempts. Request a new code.');
  }

  const isOtpValid = await verifyOtpCode(
    otpCode,
    passwordResetState.otpHash
  );

  if (isOtpValid) {
    return user;
  }

  const nextAttemptCount = (passwordResetState.attempts ?? 0) + 1;

  if (nextAttemptCount >= env.passwordResetOtpMaxAttempts) {
    clearPasswordResetState(user);
    await user.save();
    throw createHttpError('Too many invalid OTP attempts. Request a new code.');
  }

  user.passwordReset.attempts = nextAttemptCount;
  await user.save();

  throw createHttpError('The OTP code you entered is incorrect.');
};

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = await findAuthUserByEmail(email, {
    includePasswordHash: true,
  });

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw createHttpError('Invalid email or password.', 401);
  }

  if (!user.isActive) {
    throw createHttpError('This account is currently deactivated.', 403);
  }

  const populatedUser = await User.findById(user.id).populate(
    'managerId',
    'firstName lastName email'
  );

  if (!populatedUser) {
    throw createHttpError('Unable to complete sign in right now.', 500);
  }

  await logAuthEventSafely({
    userId: populatedUser.id,
    name: getFullName(populatedUser) || populatedUser.email,
    email: populatedUser.email,
    role: populatedUser.role,
    eventType: 'login',
  });

  sendSuccess(res, {
    data: {
      token: randomUUID(),
      user: populatedUser,
    },
    message: 'Sign in successful.',
  });
});

export const logout = asyncHandler(async (req, res) => {
  const userId = toOptionalString(req.body?.userId);
  const fallbackName = toOptionalString(req.body?.name);
  const fallbackEmail = toOptionalString(req.body?.email);
  const fallbackRole = toOptionalString(req.body?.role);
  const user = userId ? await User.findById(userId) : null;

  await logAuthEventSafely({
    userId: user?.id ?? userId,
    name: getFullName(user) || fallbackName,
    email: user?.email ?? fallbackEmail,
    role: user?.role ?? fallbackRole,
    eventType: 'logout',
  });

  sendSuccess(res, {
    message: 'Sign out successful.',
  });
});

export const listAuthEvents = asyncHandler(async (req, res) => {
  const authEvents = await AuthEvent.find().sort({
    createdAt: -1,
  });

  sendSuccess(res, {
    data: authEvents,
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { userId, currentPassword, nextPassword } = req.body ?? {};
  const user = await User.findById(userId).select('+passwordHash');

  if (!user) {
    throw createHttpError('User not found.', 404);
  }

  const isCurrentPasswordValid = await verifyPassword(
    currentPassword,
    user.passwordHash
  );

  if (!isCurrentPasswordValid) {
    throw createHttpError(
      'The current password you entered is incorrect.'
    );
  }

  user.passwordHash = await hashPassword(nextPassword);
  await user.save();

  sendSuccess(res, {
    message: 'Password updated successfully.',
  });
});

export const requestPasswordResetOtp = asyncHandler(async (req, res) => {
  const email = ensureValidEmail(req.body?.email);
  const user = await findAuthUserByEmail(email, {
    includePasswordReset: true,
  });

  if (!user || !user.isActive) {
    throw createHttpError(PASSWORD_RESET_EMAIL_VALIDATION_MESSAGE);
  }

  const lastSentAt = user.passwordReset?.lastSentAt?.getTime() ?? 0;
  const cooldownWindowMs = env.passwordResetOtpCooldownSeconds * 1000;

  if (Date.now() - lastSentAt < cooldownWindowMs) {
    sendSuccess(res, {
      message: PASSWORD_RESET_REQUEST_MESSAGE,
    });
    return;
  }

  const otpCode = createOtpCode();

  user.passwordReset = {
    otpHash: await hashOtpCode(otpCode),
    expiresAt: new Date(
      Date.now() + env.passwordResetOtpExpiresMinutes * 60 * 1000
    ),
    lastSentAt: new Date(),
    attempts: 0,
  };

  await user.save();

  try {
    await sendPasswordResetOtpEmail({
      toEmail: user.email,
      toName: user.name || user.firstName,
      otpCode,
    });
  } catch (error) {
    clearPasswordResetState(user);
    await user.save();
    throw error;
  }

  sendSuccess(res, {
    message: PASSWORD_RESET_REQUEST_MESSAGE,
  });
});

export const verifyPasswordResetOtp = asyncHandler(async (req, res) => {
  const email = ensureValidEmail(req.body?.email);
  const otpCode = ensureValidOtpCode(req.body?.otp);

  await validatePasswordResetOtp({
    email,
    otpCode,
  });

  sendSuccess(res, {
    message: 'OTP verified. You can now create a new password.',
  });
});

export const resetPasswordWithOtp = asyncHandler(async (req, res) => {
  const email = ensureValidEmail(req.body?.email);
  const otpCode = ensureValidOtpCode(req.body?.otp);
  const nextPassword = String(req.body?.nextPassword ?? '');

  const user = await validatePasswordResetOtp({
    email,
    otpCode,
    includePasswordHash: true,
  });

  user.passwordHash = await hashPassword(nextPassword);
  clearPasswordResetState(user);
  await user.save();

  sendSuccess(res, {
    message: 'Your password has been reset. You can sign in with the new password.',
  });
});
