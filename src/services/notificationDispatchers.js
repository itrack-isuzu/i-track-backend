import {
  createNotificationsForRoles,
  createNotificationsForUsers,
} from './notificationsService.js';

const ADMIN_APPROVER_ROLES = ['admin', 'supervisor'];
const DISPATCHER_ROLE = ['dispatcher'];
const IN_TRANSIT_HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;

const getId = (value) => {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'object') {
    if (typeof value.id === 'string' && value.id.trim()) {
      return value.id.trim();
    }

    if (typeof value._id === 'string' && value._id.trim()) {
      return value._id.trim();
    }

    if (
      value._id &&
      typeof value._id === 'object' &&
      typeof value._id.toString === 'function'
    ) {
      const nestedObjectId = value._id.toString().trim();

      if (nestedObjectId && nestedObjectId !== '[object Object]') {
        return nestedObjectId;
      }
    }

    if (typeof value.toString === 'function') {
      const stringifiedValue = value.toString().trim();

      if (stringifiedValue && stringifiedValue !== '[object Object]') {
        return stringifiedValue;
      }
    }
  }

  return '';
};

const idsAreEqual = (left, right) => getId(left) === getId(right);

const getFullName = (person) =>
  `${person?.firstName ?? ''} ${person?.lastName ?? ''}`.trim();

const getVehicleLabel = (vehicle) =>
  [vehicle?.unitName, vehicle?.variation].filter(Boolean).join(' ').trim() ||
  'Assigned vehicle';

const getLocationLabel = (location) =>
  location?.name?.trim() || location?.address?.trim() || 'selected location';

const getTextValue = (value) => String(value ?? '').trim();

const hasTextChanged = (left, right) => getTextValue(left) !== getTextValue(right);

const getPreparationDispatcherRecipientIds = (preparation) => {
  const dispatcherId = getId(preparation?.dispatcherId);

  return dispatcherId ? [dispatcherId] : [];
};

const didDriverAllocationRouteChange = (previousAllocation, nextAllocation) =>
  !idsAreEqual(previousAllocation?.vehicleId, nextAllocation?.vehicleId) ||
  getLocationLabel(previousAllocation?.pickupLocation) !==
    getLocationLabel(nextAllocation?.pickupLocation) ||
  getLocationLabel(previousAllocation?.destinationLocation) !==
    getLocationLabel(nextAllocation?.destinationLocation);

const buildDriverAllocationReferenceMessage = (allocation) =>
  `${getVehicleLabel(allocation?.vehicleId)} from ${getLocationLabel(
    allocation?.pickupLocation
  )} to ${getLocationLabel(allocation?.destinationLocation)}.`;

export const isDriverInTransitHeartbeatDue = (allocation, detectedAt = new Date()) => {
  if (allocation?.status !== 'in_transit') {
    return false;
  }

  const lastHeartbeatAt = allocation?.aiState?.lastTransitHeartbeatNotifiedAt;

  if (!lastHeartbeatAt) {
    return true;
  }

  return (
    new Date(detectedAt).getTime() - new Date(lastHeartbeatAt).getTime() >=
    IN_TRANSIT_HEARTBEAT_INTERVAL_MS
  );
};

export const notifyDriverInTransitHeartbeat = async (allocation) => {
  if (allocation?.status !== 'in_transit') {
    return [];
  }

  const managerId = getId(allocation?.managerId);
  const driverName = getFullName(allocation?.driverId) || 'The driver';
  const vehicleLabel = getVehicleLabel(allocation?.vehicleId);
  const title = 'Driver still in transit';
  const message = `${driverName} is still in transit for ${vehicleLabel}.`;
  const data = {
    entityType: 'driver_allocation',
    entityId: allocation.id,
    vehicleId: getId(allocation?.vehicleId),
    driverId: getId(allocation?.driverId),
    status: allocation?.status,
    currentLocation: allocation?.currentLocation ?? null,
    routeProgress: allocation?.routeProgress ?? null,
    heartbeatType: 'in_transit',
  };

  if (managerId) {
    return createNotificationsForUsers({
      userIds: [managerId],
      type: 'alert',
      title,
      message,
      data,
    });
  }

  return createNotificationsForRoles({
    roles: ADMIN_APPROVER_ROLES,
    type: 'alert',
    title,
    message,
    data,
  });
};

const didTestDriveScheduleChange = (previousBooking, nextBooking) =>
  !idsAreEqual(previousBooking?.vehicleId, nextBooking?.vehicleId) ||
  hasTextChanged(previousBooking?.scheduledDate, nextBooking?.scheduledDate) ||
  hasTextChanged(previousBooking?.scheduledTime, nextBooking?.scheduledTime) ||
  hasTextChanged(previousBooking?.customerName, nextBooking?.customerName);

const notifyPreparationDispatchers = async ({
  preparation,
  type = 'vehicle',
  title,
  message,
  data = {},
}) => {
  const dispatcherRecipientIds = getPreparationDispatcherRecipientIds(preparation);

  if (dispatcherRecipientIds.length) {
    return createNotificationsForUsers({
      userIds: dispatcherRecipientIds,
      type,
      title,
      message,
      data,
    });
  }

  return createNotificationsForRoles({
    roles: DISPATCHER_ROLE,
    type,
    title,
    message,
    data,
  });
};

export const notifyUnitAgentAllocationCreated = async (allocation) => {
  const salesAgentId = getId(allocation?.salesAgentId);

  if (!salesAgentId) {
    return [];
  }

  const managerName = getFullName(allocation?.managerId) || 'your manager';

  return createNotificationsForUsers({
    userIds: [salesAgentId],
    type: 'vehicle',
    title: 'Vehicle assigned to you',
    message: `${getVehicleLabel(
      allocation?.vehicleId
    )} is now assigned to you under ${managerName}.`,
    data: {
      entityType: 'unit_agent_allocation',
      entityId: allocation.id,
      vehicleId: getId(allocation?.vehicleId),
    },
  });
};

export const notifyUnitAgentAllocationUpdated = async ({
  previousAllocation,
  nextAllocation,
}) => {
  const previousSalesAgentId = getId(previousAllocation?.salesAgentId);
  const nextSalesAgentId = getId(nextAllocation?.salesAgentId);
  const vehicleLabel = getVehicleLabel(nextAllocation?.vehicleId);
  const tasks = [];

  if (previousSalesAgentId && previousSalesAgentId !== nextSalesAgentId) {
    tasks.push(
      createNotificationsForUsers({
        userIds: [previousSalesAgentId],
        type: 'vehicle',
        title: 'Vehicle reassigned',
        message: `${vehicleLabel} is no longer assigned to you.`,
        data: {
          entityType: 'unit_agent_allocation',
          entityId: nextAllocation.id,
          vehicleId: getId(nextAllocation?.vehicleId),
        },
      })
    );
  }

  if (nextSalesAgentId) {
    tasks.push(
      createNotificationsForUsers({
        userIds: [nextSalesAgentId],
        type: 'vehicle',
        title:
          previousSalesAgentId && previousSalesAgentId === nextSalesAgentId
            ? 'Vehicle assignment updated'
            : 'Vehicle assigned to you',
        message:
          previousSalesAgentId && previousSalesAgentId === nextSalesAgentId
            ? `${vehicleLabel} assignment details were updated.`
            : `${vehicleLabel} is now assigned to you.`,
        data: {
          entityType: 'unit_agent_allocation',
          entityId: nextAllocation.id,
          vehicleId: getId(nextAllocation?.vehicleId),
        },
      })
    );
  }

  return Promise.all(tasks);
};

export const notifyUnitAgentAllocationDeleted = async (allocation) => {
  const salesAgentId = getId(allocation?.salesAgentId);

  if (!salesAgentId) {
    return [];
  }

  return createNotificationsForUsers({
    userIds: [salesAgentId],
    type: 'vehicle',
    title: 'Vehicle assignment removed',
    message: `${getVehicleLabel(allocation?.vehicleId)} is no longer assigned to you.`,
    data: {
      entityType: 'unit_agent_allocation',
      entityId: allocation.id,
      vehicleId: getId(allocation?.vehicleId),
    },
  });
};

export const notifyDriverAllocationCreated = async (allocation) => {
  const driverId = getId(allocation?.driverId);

  if (!driverId) {
    return [];
  }

  return createNotificationsForUsers({
    userIds: [driverId],
    type: 'driver',
    title: 'New Driving Booking Assigned',
    message: buildDriverAllocationReferenceMessage(allocation),
    data: {
      entityType: 'driver_allocation',
      entityId: allocation.id,
      vehicleId: getId(allocation?.vehicleId),
      status: allocation?.status,
    },
  });
};

export const notifyDriverAllocationUpdated = async ({
  previousAllocation,
  nextAllocation,
}) => {
  const previousDriverId = getId(previousAllocation?.driverId);
  const nextDriverId = getId(nextAllocation?.driverId);
  const managerId = getId(nextAllocation?.managerId);
  const vehicleLabel = getVehicleLabel(nextAllocation?.vehicleId);
  const routeChanged = didDriverAllocationRouteChange(
    previousAllocation,
    nextAllocation
  );
  const tasks = [];

  if (previousDriverId && previousDriverId !== nextDriverId) {
    tasks.push(
      createNotificationsForUsers({
        userIds: [previousDriverId],
        type: 'driver',
        title: 'Drive reassigned',
        message: `${vehicleLabel} drive was reassigned to another driver.`,
        data: {
          entityType: 'driver_allocation',
          entityId: nextAllocation.id,
          vehicleId: getId(nextAllocation?.vehicleId),
        },
      })
    );
  }

  if (nextDriverId && (previousDriverId !== nextDriverId || routeChanged)) {
    tasks.push(
      createNotificationsForUsers({
        userIds: [nextDriverId],
        type: 'driver',
        title:
          previousDriverId && previousDriverId === nextDriverId
            ? 'Drive updated'
            : 'New Driving Booking Assigned',
        message: buildDriverAllocationReferenceMessage(nextAllocation),
        data: {
          entityType: 'driver_allocation',
          entityId: nextAllocation.id,
          vehicleId: getId(nextAllocation?.vehicleId),
          status: nextAllocation?.status,
        },
      })
    );
  }

  if (
    nextDriverId &&
    previousDriverId === nextDriverId &&
    previousAllocation?.status !== nextAllocation?.status &&
    nextAllocation?.status === 'cancelled'
  ) {
    tasks.push(
      createNotificationsForUsers({
        userIds: [nextDriverId],
        type: 'driver',
        title: 'Drive cancelled',
        message: `${vehicleLabel} drive was cancelled.`,
        data: {
          entityType: 'driver_allocation',
          entityId: nextAllocation.id,
          vehicleId: getId(nextAllocation?.vehicleId),
          status: nextAllocation?.status,
        },
      })
    );
  }

  if (managerId && previousAllocation?.status !== nextAllocation?.status) {
    const driverName = getFullName(nextAllocation?.driverId) || 'The driver';
    let title = '';
    let message = '';

    switch (nextAllocation?.status) {
      case 'assigned':
        title = 'Dispatch accepted';
        message = `${driverName} accepted ${vehicleLabel}.`;
        break;
      case 'in_transit':
        title = 'Trip started';
        message = `${driverName} started the trip for ${vehicleLabel}.`;
        break;
      case 'completed':
      case 'delivered':
        title = 'Trip completed';
        message = `${driverName} completed the trip for ${vehicleLabel}.`;
        break;
      case 'cancelled':
        title = 'Dispatch cancelled';
        message = `${driverName} dispatch for ${vehicleLabel} was cancelled.`;
        break;
      default:
        break;
    }

    if (title && message) {
      tasks.push(
        createNotificationsForUsers({
          userIds: [managerId],
          type: 'driver',
          title,
          message,
          data: {
            entityType: 'driver_allocation',
            entityId: nextAllocation.id,
            vehicleId: getId(nextAllocation?.vehicleId),
            status: nextAllocation?.status,
          },
        })
      );
    }
  }

  if (
    !managerId &&
    previousAllocation?.status !== nextAllocation?.status
  ) {
    const driverName = getFullName(nextAllocation?.driverId) || 'The driver';
    let title = '';
    let message = '';

    switch (nextAllocation?.status) {
      case 'assigned':
        title = 'Dispatch accepted';
        message = `${driverName} accepted ${vehicleLabel}.`;
        break;
      case 'in_transit':
        title = 'Trip started';
        message = `${driverName} started the trip for ${vehicleLabel}.`;
        break;
      case 'completed':
      case 'delivered':
        title = 'Trip completed';
        message = `${driverName} completed the trip for ${vehicleLabel}.`;
        break;
      case 'cancelled':
        title = 'Dispatch cancelled';
        message = `${driverName} dispatch for ${vehicleLabel} was cancelled.`;
        break;
      default:
        break;
    }

    if (title && message) {
      tasks.push(
        createNotificationsForRoles({
          roles: ADMIN_APPROVER_ROLES,
          type: 'driver',
          title,
          message,
          data: {
            entityType: 'driver_allocation',
            entityId: nextAllocation.id,
            vehicleId: getId(nextAllocation?.vehicleId),
            status: nextAllocation?.status,
          },
        })
      );
    }
  }

  return Promise.all(tasks);
};

export const notifyDriverAllocationDeleted = async (allocation) => {
  const driverId = getId(allocation?.driverId);
  const managerId = getId(allocation?.managerId);
  const driverName = getFullName(allocation?.driverId) || 'The assigned driver';
  const vehicleLabel = getVehicleLabel(allocation?.vehicleId);
  const notificationData = {
    entityType: 'driver_allocation',
    entityId: allocation.id,
    vehicleId: getId(allocation?.vehicleId),
    status: allocation?.status,
  };
  const tasks = [];

  if (driverId) {
    tasks.push(
      createNotificationsForUsers({
        userIds: [driverId],
        type: 'driver',
        title: 'Drive removed',
        message: `${buildDriverAllocationReferenceMessage(
          allocation
        )} This drive was removed.`,
        data: notificationData,
      })
    );
  }

  if (managerId) {
    tasks.push(
      createNotificationsForUsers({
        userIds: [managerId],
        type: 'driver',
        title: 'Dispatch removed',
        message: `${driverName} dispatch for ${vehicleLabel} was removed.`,
        data: notificationData,
      })
    );
  }

  return Promise.all(tasks);
};

export const notifyDriverAllocationCompletionRequested = async (allocation) =>
  createNotificationsForRoles({
    roles: ADMIN_APPROVER_ROLES,
    type: 'alert',
    title: 'Trip completion requested',
    message: `${
      getFullName(allocation?.driverId) || 'The driver'
    } requested an admin/supervisor review before ending the trip for ${getVehicleLabel(
      allocation?.vehicleId
    )}.`,
    data: {
      entityType: 'driver_allocation',
      entityId: allocation?.id,
      vehicleId: getId(allocation?.vehicleId),
      driverId: getId(allocation?.driverId),
      status: allocation?.status,
      requestType: 'trip_completion_review',
      currentLocation: allocation?.currentLocation ?? null,
      destinationLocation: allocation?.destinationLocation ?? null,
    },
  });

export const notifyPreparationCreated = async (preparation) => {
  const vehicleLabel = getVehicleLabel(preparation?.vehicleId);
  const notificationData = {
    entityType: 'preparation',
    entityId: preparation.id,
    vehicleId: getId(preparation?.vehicleId),
    approvalStatus: preparation?.approvalStatus,
    status: preparation?.status,
  };

  if (preparation?.approvalStatus === 'awaiting_approval') {
    return createNotificationsForRoles({
      roles: ADMIN_APPROVER_ROLES,
      type: 'alert',
      title: 'Preparation approval needed',
      message: `${vehicleLabel} requested by ${
        preparation?.requestedByName || 'a team member'
      } is waiting for approval.`,
      data: notificationData,
    });
  }

  if (preparation?.approvalStatus === 'approved') {
    return notifyPreparationDispatchers({
      preparation,
      type: 'vehicle',
      title: 'Preparation queued for dispatch',
      message: `${vehicleLabel} is approved and ready for dispatcher processing.`,
      data: notificationData,
    });
  }

  return [];
};

export const notifyPreparationUpdated = async ({
  previousPreparation,
  nextPreparation,
}) => {
  const requesterId = getId(nextPreparation?.requestedByUserId);
  const vehicleLabel = getVehicleLabel(nextPreparation?.vehicleId);
  const notificationData = {
    entityType: 'preparation',
    entityId: nextPreparation.id,
    vehicleId: getId(nextPreparation?.vehicleId),
    approvalStatus: nextPreparation?.approvalStatus,
    status: nextPreparation?.status,
  };
  const tasks = [];
  const previousDispatcherId = getId(previousPreparation?.dispatcherId);
  const nextDispatcherId = getId(nextPreparation?.dispatcherId);
  const approvalJustApproved =
    previousPreparation?.approvalStatus !== 'approved' &&
    nextPreparation?.approvalStatus === 'approved';

  if (
    previousPreparation?.approvalStatus !== 'awaiting_approval' &&
    nextPreparation?.approvalStatus === 'awaiting_approval'
  ) {
    tasks.push(
      createNotificationsForRoles({
        roles: ADMIN_APPROVER_ROLES,
        type: 'alert',
        title: 'Preparation approval needed',
        message: `${vehicleLabel} requested by ${
          nextPreparation?.requestedByName || 'a team member'
        } is waiting for approval.`,
        data: notificationData,
      })
    );
  }

  if (
    previousPreparation?.approvalStatus !== 'approved' &&
    nextPreparation?.approvalStatus === 'approved'
  ) {
    tasks.push(
      notifyPreparationDispatchers({
        preparation: nextPreparation,
        type: 'vehicle',
        title: 'Preparation approved',
        message: `${vehicleLabel} is approved and ready for in-dispatch processing.`,
        data: notificationData,
      })
    );
  }

  if (previousDispatcherId && previousDispatcherId !== nextDispatcherId) {
    tasks.push(
      createNotificationsForUsers({
        userIds: [previousDispatcherId],
        type: 'vehicle',
        title: 'Preparation reassigned',
        message: `${vehicleLabel} is no longer assigned to you for dispatcher processing.`,
        data: notificationData,
      })
    );
  }

  if (
    nextDispatcherId &&
    previousDispatcherId !== nextDispatcherId &&
    !approvalJustApproved
  ) {
    tasks.push(
      createNotificationsForUsers({
        userIds: [nextDispatcherId],
        type: 'vehicle',
        title: previousDispatcherId
          ? 'Preparation reassigned to you'
          : 'Preparation assigned to you',
        message: `${vehicleLabel} is assigned to you for dispatcher processing.`,
        data: notificationData,
      })
    );
  }

  if (
    requesterId &&
    previousPreparation?.approvalStatus !== 'rejected' &&
    nextPreparation?.approvalStatus === 'rejected'
  ) {
    tasks.push(
      createNotificationsForUsers({
        userIds: [requesterId],
        type: 'alert',
        title: 'Preparation rejected',
        message: `${vehicleLabel} preparation request was rejected.`,
        data: notificationData,
      })
    );
  }

  if (
    requesterId &&
    previousPreparation?.status !== 'completed' &&
    nextPreparation?.status === 'completed'
  ) {
    tasks.push(
      createNotificationsForUsers({
        userIds: [requesterId],
        type: 'vehicle',
        title: 'Preparation completed',
        message: `${vehicleLabel} preparation work has been completed.`,
        data: notificationData,
      })
    );
  }

  if (
    requesterId &&
    previousPreparation?.status !== 'ready_for_release' &&
    nextPreparation?.status === 'ready_for_release'
  ) {
    tasks.push(
      createNotificationsForUsers({
        userIds: [requesterId],
        type: 'vehicle',
        title: 'Vehicle ready for release',
        message: `${vehicleLabel} is now ready for release.`,
        data: notificationData,
      })
    );
  }

  return Promise.all(tasks);
};

export const notifyPreparationDeleted = async (preparation) => {
  const recipientIds = [
    ...new Set(
      [getId(preparation?.requestedByUserId), getId(preparation?.dispatcherId)].filter(
        Boolean
      )
    ),
  ];

  if (!recipientIds.length) {
    return [];
  }

  return createNotificationsForUsers({
    userIds: recipientIds,
    type: 'alert',
    title: 'Preparation request removed',
    message: `${getVehicleLabel(preparation?.vehicleId)} preparation request was removed.`,
    data: {
      entityType: 'preparation',
      entityId: preparation.id,
      vehicleId: getId(preparation?.vehicleId),
      approvalStatus: preparation?.approvalStatus,
      status: preparation?.status,
    },
  });
};

export const notifyTestDriveCreated = async (booking) => {
  if (booking?.status !== 'pending') {
    return [];
  }

  return createNotificationsForRoles({
    roles: ADMIN_APPROVER_ROLES,
    type: 'alert',
    title: 'Test drive approval needed',
    message: `${getVehicleLabel(booking?.vehicleId)} for ${
      booking?.customerName || 'a customer'
    } is waiting for approval on ${booking?.scheduledDate} at ${
      booking?.scheduledTime
    }.`,
    data: {
      entityType: 'test_drive_booking',
      entityId: booking.id,
      vehicleId: getId(booking?.vehicleId),
      status: booking?.status,
    },
  });
};

export const notifyTestDriveUpdated = async ({
  previousBooking,
  nextBooking,
}) => {
  const requesterId = getId(nextBooking?.requestedByUserId);
  const scheduleChanged = didTestDriveScheduleChange(previousBooking, nextBooking);
  const vehicleLabel = getVehicleLabel(nextBooking?.vehicleId);
  const notificationData = {
    entityType: 'test_drive_booking',
    entityId: nextBooking.id,
    vehicleId: getId(nextBooking?.vehicleId),
    status: nextBooking?.status,
  };
  const tasks = [];

  if (
    nextBooking?.status === 'pending' &&
    (previousBooking?.status !== 'pending' || scheduleChanged)
  ) {
    tasks.push(
      createNotificationsForRoles({
        roles: ADMIN_APPROVER_ROLES,
        type: 'alert',
        title:
          previousBooking?.status === 'pending'
            ? 'Pending test drive updated'
            : 'Test drive approval needed',
        message: `${vehicleLabel} for ${
          nextBooking?.customerName || 'a customer'
        } is waiting for approval on ${nextBooking?.scheduledDate} at ${
          nextBooking?.scheduledTime
        }.`,
        data: notificationData,
      })
    );
  }

  if (requesterId && scheduleChanged && previousBooking?.status === nextBooking?.status) {
    tasks.push(
      createNotificationsForUsers({
        userIds: [requesterId],
        type: 'vehicle',
        title: 'Test drive schedule updated',
        message: `${vehicleLabel} test drive for ${
          nextBooking?.customerName || 'the customer'
        } was updated to ${nextBooking?.scheduledDate} at ${
          nextBooking?.scheduledTime
        }.`,
        data: notificationData,
      })
    );
  }

  if (!requesterId || previousBooking?.status === nextBooking?.status) {
    return Promise.all(tasks);
  }

  let title = '';
  let message = '';

  switch (nextBooking?.status) {
    case 'approved':
      title = 'Test drive approved';
      message = `${vehicleLabel} test drive for ${nextBooking?.customerName} is approved for ${nextBooking?.scheduledDate} at ${nextBooking?.scheduledTime}.`;
      break;
    case 'cancelled':
      title = 'Test drive cancelled';
      message = `${vehicleLabel} test drive for ${nextBooking?.customerName} was cancelled.`;
      break;
    case 'completed':
      title = 'Test drive completed';
      message = `${vehicleLabel} test drive for ${nextBooking?.customerName} is marked completed.`;
      break;
    case 'no_show':
      title = 'Test drive marked no-show';
      message = `${vehicleLabel} test drive for ${nextBooking?.customerName} was marked as no-show.`;
      break;
    default:
      break;
  }

  if (!title || !message) {
    return Promise.all(tasks);
  }

  tasks.push(
    createNotificationsForUsers({
      userIds: [requesterId],
      type: 'vehicle',
      title,
      message,
      data: notificationData,
    })
  );

  return Promise.all(tasks);
};

export const notifyTestDriveDeleted = async (booking) => {
  const requesterId = getId(booking?.requestedByUserId);

  if (!requesterId) {
    return [];
  }

  return createNotificationsForUsers({
    userIds: [requesterId],
    type: 'alert',
    title: 'Test drive request removed',
    message: `${getVehicleLabel(booking?.vehicleId)} test drive for ${
      booking?.customerName || 'the customer'
    } was removed.`,
    data: {
      entityType: 'test_drive_booking',
      entityId: booking.id,
      vehicleId: getId(booking?.vehicleId),
      status: booking?.status,
    },
  });
};
