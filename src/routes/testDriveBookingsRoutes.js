import { Router } from 'express';

import {
  createTestDriveBooking,
  deleteTestDriveBooking,
  getTestDriveBookingById,
  listTestDriveBookings,
  updateTestDriveBooking,
} from '../controllers/testDriveBookingsController.js';

const router = Router();

router.get('/', listTestDriveBookings);
router.post('/', createTestDriveBooking);
router.get('/:id', getTestDriveBookingById);
router.patch('/:id', updateTestDriveBooking);
router.delete('/:id', deleteTestDriveBooking);

export default router;
