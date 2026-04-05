import { User } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { hashPassword } from '../utils/passwords.js';

const buildUserFilters = (query) => {
  const filters = {};

  if (query.role) {
    filters.role = query.role;
  }

  if (query.isActive !== undefined) {
    filters.isActive = query.isActive === 'true';
  }

  if (query.search) {
    const pattern = new RegExp(query.search, 'i');
    filters.$or = [
      { firstName: pattern },
      { lastName: pattern },
      { email: pattern },
      { phone: pattern },
    ];
  }

  return filters;
};

const requireUser = async (id) => {
  const user = await User.findById(id).populate(
    'managerId',
    'firstName lastName email'
  );

  if (!user) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    throw error;
  }

  return user;
};

export const listUsers = asyncHandler(async (req, res) => {
  const users = await User.find(buildUserFilters(req.query))
    .populate('managerId', 'firstName lastName email')
    .sort({ createdAt: -1 });

  sendSuccess(res, {
    data: users,
    message: 'Users fetched successfully.',
  });
});

export const getUserById = asyncHandler(async (req, res) => {
  const user = await requireUser(req.params.id);

  sendSuccess(res, {
    data: user,
    message: 'User fetched successfully.',
  });
});

export const createUser = asyncHandler(async (req, res) => {
  const { password, ...payload } = req.body ?? {};
  const user = await User.create({
    ...payload,
    passwordHash: await hashPassword(password),
  });
  const savedUser = await requireUser(user.id);

  sendSuccess(res, {
    status: 201,
    data: savedUser,
    message: 'User created successfully.',
  });
});

export const updateUser = asyncHandler(async (req, res) => {
  const { password, ...payload } = req.body ?? {};
  const nextPayload = {
    ...payload,
  };

  if (password) {
    nextPayload.passwordHash = await hashPassword(password);
  }

  const user = await User.findByIdAndUpdate(req.params.id, nextPayload, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    throw error;
  }

  const savedUser = await requireUser(user.id);

  sendSuccess(res, {
    data: savedUser,
    message: 'User updated successfully.',
  });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id);

  if (!user) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    throw error;
  }

  sendSuccess(res, {
    data: user,
    message: 'User deleted successfully.',
  });
});
