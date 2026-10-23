import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { authenticatedId, accessError } from '../middleware/operationAccess.js';
import { resolveNotificationTarget } from '../services/notificationTargetService.js';
import {
  createNotificationsForUsers,
  registerUserPushToken,
  unregisterUserPushToken,
} from '../services/notificationsService.js';

const createHttpError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const requireUserId = (req) => {
  const userId = authenticatedId(req);
  if (!userId) throw accessError('Please sign in again.', 401);
  const suppliedId = req.body?.userId ?? req.query?.userId;
  if (suppliedId !== undefined && String(suppliedId) !== userId) throw accessError('Notifications and push tokens belong to the signed-in account.');
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
  const userId = requireUserId(req);
  const notifications = await Notification.find({
    userId,
  }).sort({ createdAt: -1 });

  sendSuccess(res, {
    data: notifications,
    message: 'Notifications fetched successfully.',
  });
});

export const getNotificationTarget = asyncHandler(async (req, res) => {
  const notification = await requireNotificationForUser(req.params.id, requireUserId(req));
  sendSuccess(res, { data: await resolveNotificationTarget(req, notification) });
});

export const getPushStatus = asyncHandler(async (req, res) => {
  const userId = requireUserId(req);
  const [user, latest] = await Promise.all([
    User.findById(userId).select('pushTokens'),
    Notification.findOne({ userId, 'pushDeliveries.0': { $exists: true } }).sort({ createdAt: -1 }).select('+pushDeliveries'),
  ]);
  sendSuccess(res, { data: {
    activeDevices: (user?.pushTokens ?? []).filter((token) => token.isActive).length,
    latestNotificationId: latest?.id ?? null,
    deliveries: (latest?.pushDeliveries ?? []).map((delivery) => ({ status: delivery.status, error: delivery.error || '', checkedAt: delivery.checkedAt ?? null })),
    message: 'Queued means Expo accepted the request. Accepted means FCM/APNs accepted it. Confirm display on the device separately.',
  } });
});

export const createNotification = asyncHandler(async (req, res) => {
  const userId = requireUserId(req);
  const title = String(req.body?.title ?? '').trim().slice(0, 150);
  const message = String(req.body?.message ?? '').trim().slice(0, 1500);
  if (!title || !message) throw createHttpError('Notification title and message are required.');
  const data = req.body?.data && typeof req.body.data === 'object' && !Array.isArray(req.body.data) ? req.body.data : {};
  const target = await resolveNotificationTarget(req, { data });
  if (!target.available) throw createHttpError('A visible operational record is required for this notification.', 404);
  const notifications = await createNotificationsForUsers({ userIds: [userId], type: 'alert', title, message, data });
  sendSuccess(res, { status: 201, data: notifications[0] });
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const userId = requireUserId(req);
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
  const userId = requireUserId(req);
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
  const userId = requireUserId(req);
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
  const userId = requireUserId(req);
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
  const userId = requireUserId(req);
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
  const userId = requireUserId(req);
  const pushTokens = await unregisterUserPushToken({
    userId,
    token: req.body?.token,
  });

  sendSuccess(res, {
    data: pushTokens,
    message: 'Push token removed successfully.',
  });
});

export const sendTestNotification = asyncHandler(async (req, res) => {
  const userId = requireUserId(req);
  const issuedAt = new Date().toISOString();
  const notifications = await createNotificationsForUsers({
    userIds: [userId],
    type: 'alert',
    title: 'Test notification',
    message:
      'If you received this on your device, push notifications are working.',
    data: {
      entityType: 'test_notification',
      issuedAt,
    },
  });

  const delivery = notifications[0] ? await Notification.findById(notifications[0].id).select('+pushDeliveries') : null;
  const queued = delivery?.pushDeliveries?.some((item) => item.status === 'queued');

  sendSuccess(res, {
    status: 201,
    data: notifications[0] ?? null,
    message: queued
      ? 'Saved to your inbox and queued with Expo. Confirm that an alert appears on the physical device; provider acceptance does not confirm display.'
      : 'Saved to your inbox, but no push was queued. Check device registration and the server push delivery logs.',
  });
});
