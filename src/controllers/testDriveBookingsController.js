import { TestDriveBooking } from '../models/TestDriveBooking.js';
import { Vehicle } from '../models/Vehicle.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

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

const requireBooking = async (id) => {
  const booking = await TestDriveBooking.findById(id).populate(bookingPopulation);

  if (!booking) {
    const error = new Error('Test drive booking not found.');
    error.statusCode = 404;
    throw error;
  }

  return booking;
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
  await requireVehicle(req.body?.vehicleId);
  const booking = await TestDriveBooking.create(req.body);
  const savedBooking = await requireBooking(booking.id);

  sendSuccess(res, {
    status: 201,
    data: savedBooking,
    message: 'Test drive booking created successfully.',
  });
});

export const updateTestDriveBooking = asyncHandler(async (req, res) => {
  const existingBooking = await TestDriveBooking.findById(req.params.id);

  if (!existingBooking) {
    const error = new Error('Test drive booking not found.');
    error.statusCode = 404;
    throw error;
  }

  await requireVehicle(req.body?.vehicleId ?? existingBooking.vehicleId);

  await TestDriveBooking.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  const savedBooking = await requireBooking(req.params.id);

  sendSuccess(res, {
    data: savedBooking,
    message: 'Test drive booking updated successfully.',
  });
});

export const deleteTestDriveBooking = asyncHandler(async (req, res) => {
  const booking = await TestDriveBooking.findByIdAndDelete(req.params.id);

  if (!booking) {
    const error = new Error('Test drive booking not found.');
    error.statusCode = 404;
    throw error;
  }

  sendSuccess(res, {
    data: booking,
    message: 'Test drive booking deleted successfully.',
  });
});
