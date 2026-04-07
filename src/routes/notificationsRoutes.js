import { Router } from 'express';

import {
  clearNotifications,
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  registerPushToken,
  sendTestNotification,
  unregisterPushToken,
} from '../controllers/notificationsController.js';

const router = Router();

router.get('/', listNotifications);
router.patch('/read-all', markAllNotificationsRead);
router.post('/test', sendTestNotification);
router.post('/push-token', registerPushToken);
router.delete('/push-token', unregisterPushToken);
router.patch('/:id/read', markNotificationRead);
router.delete('/:id', deleteNotification);
router.delete('/', clearNotifications);

export default router;
