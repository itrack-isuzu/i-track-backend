import { randomUUID } from 'node:crypto';

import { User } from '../models/User.js';
import { verifyPassword, hashPassword } from '../utils/passwords.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

const findAuthUserByEmail = async (email) =>
  User.findOne({
    email: String(email ?? '').trim().toLowerCase(),
  }).select('+passwordHash');

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = await findAuthUserByEmail(email);

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    const error = new Error('Invalid email or password.');
    error.statusCode = 401;
    throw error;
  }

  if (!user.isActive) {
    const error = new Error('This account is currently deactivated.');
    error.statusCode = 403;
    throw error;
  }

  sendSuccess(res, {
    data: {
      token: randomUUID(),
      user: await User.findById(user.id).populate(
        'managerId',
        'firstName lastName email'
      ),
    },
    message: 'Sign in successful.',
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { userId, currentPassword, nextPassword } = req.body ?? {};
  const user = await User.findById(userId).select('+passwordHash');

  if (!user) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    throw error;
  }

  const isCurrentPasswordValid = await verifyPassword(
    currentPassword,
    user.passwordHash
  );

  if (!isCurrentPasswordValid) {
    const error = new Error('The current password you entered is incorrect.');
    error.statusCode = 400;
    throw error;
  }

  user.passwordHash = await hashPassword(nextPassword);
  await user.save();

  sendSuccess(res, {
    message: 'Password updated successfully.',
  });
});
