import {
  createNotificationsForRoles,
  createNotificationsForUsers,
} from './notificationsService.js';

const ADMIN_APPROVER_ROLES = ['admin', 'supervisor'];
const DISPATCHER_ROLE = ['dispatcher'];

const getId = (value) => String(value?.id ?? value ?? '').trim();

const idsAreEqual = (left, right) => getId(left) === getId(right);

const getFullName = (person) =>
  `${person?.firstName ?? ''} ${person?.lastName ?? ''}`.trim();

const getVehicleLabel = (vehicle) =>
  [vehicle?.unitName, vehicle?.variation].filter(Boolean).join(' ').trim() ||
  'Assigned vehicle';

const getLocationLabel = (location) =>
  location?.name?.trim() || location?.address?.trim() || 'selected location';

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

export const notifyDriverAllocationCreated = async (allocation) => {
  const driverId = getId(allocation?.driverId);

  if (!driverId) {
    return [];
  }

  return createNotificationsForUsers({
    userIds: [driverId],
    type: 'driver',
    title: 'New dispatch assigned',
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
        title: 'Dispatch reassigned',
        message: `${vehicleLabel} dispatch was reassigned to another driver.`,
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
            ? 'Dispatch updated'
            : 'New dispatch assigned',
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

  return Promise.all(tasks);
};

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

  if (!requesterId || previousBooking?.status === nextBooking?.status) {
    return [];
  }

  const vehicleLabel = getVehicleLabel(nextBooking?.vehicleId);
  const notificationData = {
    entityType: 'test_drive_booking',
    entityId: nextBooking.id,
    vehicleId: getId(nextBooking?.vehicleId),
    status: nextBooking?.status,
  };

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
    return [];
  }

  return createNotificationsForUsers({
    userIds: [requesterId],
    type: 'vehicle',
    title,
    message,
    data: notificationData,
  });
};
