import { Expo } from 'expo-server-sdk';

import { env } from '../config/env.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';

const expo = env.expoAccessToken
  ? new Expo({
      accessToken: env.expoAccessToken,
    })
  : new Expo();

const VALID_PUSH_PLATFORMS = new Set(['android', 'ios', 'web', 'unknown']);
const MAX_PUSH_TOKENS_PER_USER = 10;

const createHttpError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeUserIds = (userIds = []) =>
  [...new Set(userIds.map((userId) => String(userId ?? '').trim()).filter(Boolean))];

const normalizePushPlatform = (platform) => {
  const normalizedPlatform = String(platform ?? '').trim().toLowerCase();

  return VALID_PUSH_PLATFORMS.has(normalizedPlatform)
    ? normalizedPlatform
    : 'unknown';
};

const normalizePushToken = (token) => String(token ?? '').trim();

const markInvalidPushTokensInactive = async (tokens) => {
  if (!tokens.length) {
    return;
  }

  await User.updateMany(
    {
      'pushTokens.token': {
        $in: tokens,
      },
    },
    {
      $set: {
        'pushTokens.$[pushToken].isActive': false,
      },
    },
    {
      arrayFilters: [
        {
          'pushToken.token': {
            $in: tokens,
          },
        },
      ],
    }
  );
};

const sendPushNotifications = async ({
  users,
  notifications,
  title,
  message,
  data = {},
}) => {
  const notificationIdByUserId = new Map(
    notifications.map((notification) => [
      String(notification.userId),
      String(notification.id),
    ])
  );
  const messages = [];

  users.forEach((user) => {
    const notificationId = notificationIdByUserId.get(String(user.id));

    (user.pushTokens ?? []).forEach((pushToken) => {
      if (!pushToken?.isActive || !Expo.isExpoPushToken(pushToken.token)) {
        return;
      }

      messages.push({
        to: pushToken.token,
        sound: 'default',
        title,
        body: message,
        priority: 'high',
        channelId: 'itrack-alerts',
        data: {
          ...data,
          notificationId,
          userId: String(user.id),
        },
      });
    });
  });

  if (!messages.length) {
    return;
  }

  const invalidTokens = new Set();

  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);

      tickets.forEach((ticket, index) => {
        if (ticket.status !== 'error') {
          return;
        }

        const errorCode = ticket.details?.error;

        if (errorCode === 'DeviceNotRegistered') {
          invalidTokens.add(chunk[index]?.to);
        }

        console.error(
          'Expo push delivery failed:',
          ticket.message || errorCode || 'Unknown Expo push error.'
        );
      });
    } catch (error) {
      console.error('Expo push chunk delivery failed:', error);
    }
  }

  const invalidTokenList = [...invalidTokens].filter(Boolean);

  if (invalidTokenList.length) {
    await markInvalidPushTokensInactive(invalidTokenList);
  }
};

export const createNotificationsForUsers = async ({
  userIds,
  type = 'system',
  title,
  message,
  data = {},
}) => {
  const normalizedUserIds = normalizeUserIds(userIds);
  const normalizedTitle = String(title ?? '').trim();
  const normalizedMessage = String(message ?? '').trim();

  if (!normalizedUserIds.length || !normalizedTitle || !normalizedMessage) {
    return [];
  }

  const users = await User.find({
    _id: {
      $in: normalizedUserIds,
    },
    isActive: true,
  }).select('pushTokens');

  if (!users.length) {
    return [];
  }

  const notifications = await Notification.insertMany(
    users.map((user) => ({
      userId: user.id,
      type,
      title: normalizedTitle,
      message: normalizedMessage,
      data,
    }))
  );

  await sendPushNotifications({
    users,
    notifications,
    title: normalizedTitle,
    message: normalizedMessage,
    data,
  });

  return notifications;
};

export const createNotificationsForRoles = async ({
  roles = [],
  type = 'system',
  title,
  message,
  data = {},
}) => {
  const normalizedRoles = [
    ...new Set(roles.map((role) => String(role ?? '').trim()).filter(Boolean)),
  ];

  if (!normalizedRoles.length) {
    return [];
  }

  const recipients = await User.find({
    role: {
      $in: normalizedRoles,
    },
    isActive: true,
  }).select('_id');

  return createNotificationsForUsers({
    userIds: recipients.map((recipient) => recipient.id),
    type,
    title,
    message,
    data,
  });
};

export const registerUserPushToken = async ({
  userId,
  token,
  platform,
  deviceName,
  projectId,
}) => {
  const normalizedToken = normalizePushToken(token);

  if (!normalizedToken) {
    throw createHttpError('Push token is required.');
  }

  const user = await User.findById(userId);

  if (!user) {
    throw createHttpError('User not found.', 404);
  }

  const nextPushTokens = (user.pushTokens ?? [])
    .filter((pushToken) => pushToken.token !== normalizedToken)
    .slice(-(MAX_PUSH_TOKENS_PER_USER - 1));

  nextPushTokens.push({
    token: normalizedToken,
    platform: normalizePushPlatform(platform),
    deviceName: String(deviceName ?? '').trim(),
    projectId: String(projectId ?? '').trim() || null,
    isActive: true,
    lastRegisteredAt: new Date(),
  });

  user.pushTokens = nextPushTokens;
  await user.save();

  return user.pushTokens;
};

export const unregisterUserPushToken = async ({ userId, token }) => {
  const normalizedToken = normalizePushToken(token);

  if (!normalizedToken) {
    throw createHttpError('Push token is required.');
  }

  const user = await User.findById(userId);

  if (!user) {
    throw createHttpError('User not found.', 404);
  }

  user.pushTokens = (user.pushTokens ?? []).filter(
    (pushToken) => pushToken.token !== normalizedToken
  );
  await user.save();

  return user.pushTokens;
};
