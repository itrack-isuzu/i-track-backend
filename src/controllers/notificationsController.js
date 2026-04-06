import { Notification } from '../models/Notification.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  registerUserPushToken,
  unregisterUserPushToken,
} from '../services/notificationsService.js';

const createHttpError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const requireUserId = (value) => {
  const userId = String(value ?? '').trim();

  if (!userId) {
    throw createHttpError('User id is required.');
  }

  return userId;
};

const requireNotificationForUser = async (notificationId, userId) => {
  const notification = await Notification.findOne({
    _id: notificationId,
    userId,
  });

  if (!notification) {
    throw createHttpError('Notification not found.', 404);
  }

  return notification;
};

export const listNotifications = asyncHandler(async (req, res) => {
  const userId = requireUserId(req.query.userId);
  const notifications = await Notification.find({
    userId,
  }).sort({ createdAt: -1 });

  sendSuccess(res, {
    data: notifications,
    message: 'Notifications fetched successfully.',
  });
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const userId = requireUserId(req.body?.userId ?? req.query.userId);
  const notification = await requireNotificationForUser(req.params.id, userId);

  if (!notification.read) {
    notification.read = true;
    notification.readAt = new Date();
    await notification.save();
  }

  sendSuccess(res, {
    data: notification,
    message: 'Notification marked as read.',
  });
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const userId = requireUserId(req.body?.userId ?? req.query.userId);
  const readAt = new Date();

  await Notification.updateMany(
    {
      userId,
      read: false,
    },
    {
      $set: {
        read: true,
        readAt,
      },
    }
  );

  const notifications = await Notification.find({
    userId,
  }).sort({ createdAt: -1 });

  sendSuccess(res, {
    data: notifications,
    message: 'All notifications marked as read.',
  });
});

export const deleteNotification = asyncHandler(async (req, res) => {
  const userId = requireUserId(req.body?.userId ?? req.query.userId);
  const notification = await Notification.findOneAndDelete({
    _id: req.params.id,
    userId,
  });

  if (!notification) {
    throw createHttpError('Notification not found.', 404);
  }

  sendSuccess(res, {
    data: notification,
    message: 'Notification deleted successfully.',
  });
});

export const clearNotifications = asyncHandler(async (req, res) => {
  const userId = requireUserId(req.body?.userId ?? req.query.userId);
  const result = await Notification.deleteMany({
    userId,
  });

  sendSuccess(res, {
    data: {
      deletedCount: result.deletedCount,
    },
    message: 'Notifications cleared successfully.',
  });
});

export const registerPushToken = asyncHandler(async (req, res) => {
  const userId = requireUserId(req.body?.userId);
  const pushTokens = await registerUserPushToken({
    userId,
    token: req.body?.token,
    platform: req.body?.platform,
    deviceName: req.body?.deviceName,
    projectId: req.body?.projectId,
  });

  sendSuccess(res, {
    data: pushTokens,
    message: 'Push token registered successfully.',
  });
});

export const unregisterPushToken = asyncHandler(async (req, res) => {
  const userId = requireUserId(req.body?.userId);
  const pushTokens = await unregisterUserPushToken({
    userId,
    token: req.body?.token,
  });

  sendSuccess(res, {
    data: pushTokens,
    message: 'Push token removed successfully.',
  });
});
