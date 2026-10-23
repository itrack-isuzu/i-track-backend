import { Expo } from 'expo-server-sdk';
import { env } from '../config/env.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';

const expo = new Expo(env.expoAccessToken ? { accessToken: env.expoAccessToken } : {});
let running = false;
export async function checkPushReceipts() {
  if (running) return;
  running = true;
  try {
    const notifications = await Notification.find({ pushDeliveries: { $elemMatch: {
      status: 'queued', nextCheckAt: { $lte: new Date() },
    } } }).select('+pushDeliveries').limit(100);
    for (const notification of notifications) {
      const pending = notification.pushDeliveries.filter((delivery) => delivery.status === 'queued' && delivery.ticketId && delivery.nextCheckAt <= new Date());
      for (const chunk of expo.chunkPushNotificationReceiptIds(pending.map((delivery) => delivery.ticketId))) {
        const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
        for (const delivery of pending.filter((item) => chunk.includes(item.ticketId))) {
          const receipt = receipts[delivery.ticketId];
          const attempts = (delivery.attempts ?? 0) + 1;
          const status = receipt?.status === 'ok' ? 'accepted' : receipt?.status === 'error' ? 'error' : attempts >= 4 ? 'unknown' : 'queued';
          await Notification.updateOne({ _id: notification.id }, { $set: {
            'pushDeliveries.$[delivery].status': status,
            'pushDeliveries.$[delivery].error': receipt?.details?.error || (receipt?.status === 'error' ? receipt.message : ''),
            'pushDeliveries.$[delivery].checkedAt': new Date(),
            'pushDeliveries.$[delivery].attempts': attempts,
            'pushDeliveries.$[delivery].nextCheckAt': new Date(Date.now() + 15 * 60_000),
          } }, { arrayFilters: [{ 'delivery.ticketId': delivery.ticketId, 'delivery.status': 'queued' }] });
          if (receipt?.status === 'error') console.error('[push-receipt]', receipt.details?.error || receipt.message);
          if (receipt?.details?.error === 'DeviceNotRegistered') {
            await User.updateMany({ 'pushTokens.token': delivery.token }, { $pull: { pushTokens: { token: delivery.token } } });
          }
        }
      }
    }
  } finally { running = false; }
}
export function startPushReceiptMonitor() {
  const run = () => void checkPushReceipts().catch((error) => console.error('[push-receipts]', error.message));
  run();
  const timer = setInterval(run, 60_000);
  timer.unref?.();
}
