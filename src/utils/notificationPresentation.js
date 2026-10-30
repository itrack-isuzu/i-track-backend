// Present existing inbox records with the same wording as new notifications.
// Stored history, identifiers, read state, and notification targets stay intact.
export const presentNotification = (notification) => {
  const record = notification?.toJSON ? notification.toJSON() : { ...notification };
  if (record.data?.entityType === 'driver_allocation' &&
      ['Dispatch cancelled', 'Drive cancelled'].includes(record.title)) {
    record.title = 'Delivery cancelled';
    record.message = record.message?.replace(/\s+dispatch\s+for\b/gi, "'s delivery for").replace(/\b(dispatch|drive)\b/gi, 'delivery');
  }
  return record;
};
