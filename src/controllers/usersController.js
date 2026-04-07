import { User } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  generateTemporaryPassword,
  hashPassword,
} from '../utils/passwords.js';
import { sendUserAccountCredentialsEmail } from '../services/emailjsService.js';
import {
  ensureUniquePhoneNumber,
  ensureValidPhoneNumber,
} from '../utils/phoneNumbers.js';

const AVATAR_DATA_URL_PATTERN =
  /^data:image\/(?:png|jpeg|jpg|webp);base64,[a-z0-9+/=]+$/i;
const HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;
const MAX_AVATAR_URL_LENGTH = 5 * 1024 * 1024;

const createHttpError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();

const getUserRoleLabel = (role) => {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'supervisor':
      return 'Supervisor';
    case 'manager':
      return 'Manager';
    case 'sales_agent':
      return 'Sales Agent';
    case 'dispatcher':
      return 'Dispatcher';
    case 'driver':
      return 'Driver';
    default:
      return 'User';
  }
};

const normalizeAvatarUrl = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalizedAvatarUrl = String(value).trim();

  if (!normalizedAvatarUrl) {
    return null;
  }

  if (normalizedAvatarUrl.length > MAX_AVATAR_URL_LENGTH) {
    throw createHttpError(
      'Profile image is too large. Please choose a smaller image.'
    );
  }

  if (
    !AVATAR_DATA_URL_PATTERN.test(normalizedAvatarUrl) &&
    !HTTP_URL_PATTERN.test(normalizedAvatarUrl)
  ) {
    throw createHttpError('Profile image format is invalid.');
  }

  return normalizedAvatarUrl;
};

const validateManagerAssignment = async ({ id, role, managerId }) => {
  if (role !== 'sales_agent') {
    return null;
  }

  const normalizedManagerId = String(managerId ?? '').trim();

  if (!normalizedManagerId) {
    throw createHttpError('Sales agents must be assigned to a manager.');
  }

  if (id && String(id) === normalizedManagerId) {
    throw createHttpError('Sales agents cannot be assigned to themselves.');
  }

  const manager = await User.findById(normalizedManagerId);

  if (!manager) {
    throw createHttpError('Selected manager was not found.');
  }

  if (manager.role !== 'manager') {
    throw createHttpError(
      'Sales agents must be assigned to a user with the Manager role.'
    );
  }

  return manager.id;
};

const buildValidatedUserPayload = async ({
  id,
  email,
  phone,
  firstName,
  lastName,
  bio,
  role,
  managerId,
  isActive,
  avatarUrl,
}) => {
  const normalizedPhoneNumber = ensureValidPhoneNumber(phone);
  const validatedManagerId = await validateManagerAssignment({
    id,
    role,
    managerId,
  });

  await ensureUniquePhoneNumber({
    model: User,
    field: 'phone',
    value: normalizedPhoneNumber,
    excludeId: id,
  });

  return {
    email: normalizeEmail(email),
    phone: normalizedPhoneNumber,
    firstName:
      typeof firstName === 'string' ? firstName.trim() : firstName,
    lastName:
      typeof lastName === 'string' ? lastName.trim() : lastName,
    bio: typeof bio === 'string' ? bio.trim() : bio,
    role,
    managerId: validatedManagerId,
    isActive,
    avatarUrl: normalizeAvatarUrl(avatarUrl),
  };
};

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
  const {
    password,
    sendCredentialsEmail = false,
    ...payload
  } = req.body ?? {};
  const validatedPayload = await buildValidatedUserPayload(payload);
  const normalizedPassword =
    typeof password === 'string' && password.trim()
      ? password.trim()
      : sendCredentialsEmail
        ? generateTemporaryPassword()
        : '';

  if (!normalizedPassword) {
    throw createHttpError(
      'Password is required when credential email delivery is disabled.'
    );
  }

  const user = await User.create({
    ...validatedPayload,
    passwordHash: await hashPassword(normalizedPassword),
  });

  try {
    if (sendCredentialsEmail) {
      await sendUserAccountCredentialsEmail({
        toEmail: validatedPayload.email,
        toName:
          `${validatedPayload.firstName ?? ''} ${validatedPayload.lastName ?? ''}`.trim() ||
          validatedPayload.email,
        roleLabel: getUserRoleLabel(validatedPayload.role),
        temporaryPassword: normalizedPassword,
      });
    }
  } catch (error) {
    await User.findByIdAndDelete(user.id).catch(() => null);
    throw error;
  }

  const savedUser = await requireUser(user.id);

  sendSuccess(res, {
    status: 201,
    data: savedUser,
    message: sendCredentialsEmail
      ? 'User created successfully and login credentials were sent by email.'
      : 'User created successfully.',
  });
});

export const updateUser = asyncHandler(async (req, res) => {
  const { password, ...payload } = req.body ?? {};
  const existingUser = await User.findById(req.params.id);

  if (!existingUser) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    throw error;
  }

  const validatedPayload = await buildValidatedUserPayload({
    id: existingUser.id,
    email: payload.email ?? existingUser.email,
    phone: payload.phone ?? existingUser.phone,
    firstName: payload.firstName ?? existingUser.firstName,
    lastName: payload.lastName ?? existingUser.lastName,
    bio: payload.bio ?? existingUser.bio,
    role: payload.role ?? existingUser.role,
    managerId:
      payload.managerId === undefined
        ? existingUser.managerId
        : payload.managerId,
    isActive:
      payload.isActive === undefined
        ? existingUser.isActive
        : payload.isActive,
    avatarUrl:
      payload.avatarUrl === undefined
        ? existingUser.avatarUrl
        : payload.avatarUrl,
  });
  const nextPayload = {
    ...validatedPayload,
  };

  if (password) {
    nextPayload.passwordHash = await hashPassword(password);
  }

  const user = await User.findByIdAndUpdate(req.params.id, nextPayload, {
    new: true,
    runValidators: true,
  });

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
