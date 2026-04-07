import { TestDriveBooking } from '../models/TestDriveBooking.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import {
  notifyTestDriveCreated,
  notifyTestDriveDeleted,
  notifyTestDriveUpdated,
} from '../services/notificationDispatchers.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  ensureUniquePhoneNumber,
  ensureValidPhoneNumber,
} from '../utils/phoneNumbers.js';

const dispatchNotificationTask = (task, label) => {
  void task.catch((error) => {
    console.error(`Notification dispatch failed (${label}):`, error);
  });
};

const bookingPopulation = [
  {
    path: 'vehicleId',
    select: 'unitName variation conductionNumber bodyColor status',
  },
];

const buildFilters = (query) => {
  const filters = {};

  if (query.status) {
    filters.status = query.status;
  }

  if (query.vehicleId) {
    filters.vehicleId = query.vehicleId;
  }

  return filters;
};

const requireVehicle = async (vehicleId) => {
  const vehicle = await Vehicle.findById(vehicleId);

  if (!vehicle) {
    const error = new Error('Vehicle not found.');
    error.statusCode = 400;
    throw error;
  }

  return vehicle;
};

const requireOptionalRequester = async (requesterId) => {
  if (!requesterId) {
    return null;
  }

  const requester = await User.findById(requesterId);

  if (!requester) {
    const error = new Error('Requester not found.');
    error.statusCode = 400;
    throw error;
  }

  return requester;
};

const requireBooking = async (id) => {
  const booking = await TestDriveBooking.findById(id).populate(bookingPopulation);

  if (!booking) {
    const error = new Error('Test drive booking not found.');
    error.statusCode = 404;
    throw error;
  }

  return booking;
};

const buildValidatedPayload = async ({
  id,
  vehicleId,
  requestedByUserId,
  customerName,
  customerPhone,
  scheduledDate,
  scheduledTime,
  notes,
  status,
}) => {
  const normalizedPhoneNumber = ensureValidPhoneNumber(
    customerPhone,
    'Customer phone number'
  );

  await ensureUniquePhoneNumber({
    model: TestDriveBooking,
    field: 'customerPhone',
    value: normalizedPhoneNumber,
    excludeId: id,
    label: 'Customer phone number',
  });

  return {
    vehicleId,
    requestedByUserId: requestedByUserId ?? null,
    customerName:
      typeof customerName === 'string' ? customerName.trim() : customerName,
    customerPhone: normalizedPhoneNumber,
    scheduledDate:
      typeof scheduledDate === 'string' ? scheduledDate.trim() : scheduledDate,
    scheduledTime:
      typeof scheduledTime === 'string' ? scheduledTime.trim() : scheduledTime,
    notes: typeof notes === 'string' ? notes.trim() : notes,
    status,
  };
};

export const listTestDriveBookings = asyncHandler(async (req, res) => {
  const bookings = await TestDriveBooking.find(buildFilters(req.query))
    .populate(bookingPopulation)
    .sort({ scheduledDate: 1, scheduledTime: 1, createdAt: -1 });

  sendSuccess(res, {
    data: bookings,
    message: 'Test drive bookings fetched successfully.',
  });
});

export const getTestDriveBookingById = asyncHandler(async (req, res) => {
  const booking = await requireBooking(req.params.id);

  sendSuccess(res, {
    data: booking,
    message: 'Test drive booking fetched successfully.',
  });
});

export const createTestDriveBooking = asyncHandler(async (req, res) => {
  const validatedPayload = await buildValidatedPayload(req.body ?? {});
  await Promise.all([
    requireVehicle(validatedPayload.vehicleId),
    requireOptionalRequester(validatedPayload.requestedByUserId),
  ]);
  const booking = await TestDriveBooking.create(validatedPayload);
  const savedBooking = await requireBooking(booking.id);
  dispatchNotificationTask(
    notifyTestDriveCreated(savedBooking),
    'test drive create'
  );

  sendSuccess(res, {
    status: 201,
    data: savedBooking,
    message: 'Test drive booking created successfully.',
  });
});

export const updateTestDriveBooking = asyncHandler(async (req, res) => {
  const previousBooking = await requireBooking(req.params.id);
  const existingBooking = await TestDriveBooking.findById(req.params.id);

  if (!existingBooking) {
    const error = new Error('Test drive booking not found.');
    error.statusCode = 404;
    throw error;
  }

  const validatedPayload = await buildValidatedPayload({
    id: existingBooking.id,
    vehicleId: req.body?.vehicleId ?? existingBooking.vehicleId,
    requestedByUserId:
      req.body?.requestedByUserId === undefined
        ? existingBooking.requestedByUserId
        : req.body.requestedByUserId,
    customerName: req.body?.customerName ?? existingBooking.customerName,
    customerPhone: req.body?.customerPhone ?? existingBooking.customerPhone,
    scheduledDate: req.body?.scheduledDate ?? existingBooking.scheduledDate,
    scheduledTime: req.body?.scheduledTime ?? existingBooking.scheduledTime,
    notes: req.body?.notes ?? existingBooking.notes,
    status: req.body?.status ?? existingBooking.status,
  });

  await Promise.all([
    requireVehicle(validatedPayload.vehicleId),
    requireOptionalRequester(validatedPayload.requestedByUserId),
  ]);

  await TestDriveBooking.findByIdAndUpdate(req.params.id, validatedPayload, {
    new: true,
    runValidators: true,
  });

  const savedBooking = await requireBooking(req.params.id);
  dispatchNotificationTask(
    notifyTestDriveUpdated({
      previousBooking,
      nextBooking: savedBooking,
    }),
    'test drive update'
  );

  sendSuccess(res, {
    data: savedBooking,
    message: 'Test drive booking updated successfully.',
  });
});

export const deleteTestDriveBooking = asyncHandler(async (req, res) => {
  const existingBooking = await requireBooking(req.params.id);
  const booking = await TestDriveBooking.findByIdAndDelete(req.params.id);

  if (!booking) {
    const error = new Error('Test drive booking not found.');
    error.statusCode = 404;
    throw error;
  }

  dispatchNotificationTask(
    notifyTestDriveDeleted(existingBooking),
    'test drive delete'
  );

  sendSuccess(res, {
    data: booking,
    message: 'Test drive booking deleted successfully.',
  });
});
