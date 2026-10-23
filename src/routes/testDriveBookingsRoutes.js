import { Router } from 'express';
import { WEB_OPERATION_ROLES, requireRoles, requireScopedRecord, resourceScope } from '../middleware/operationAccess.js';

import {
  createTestDriveBooking,
  deleteTestDriveBooking,
  getTestDriveBookingById,
  listTestDriveBookings,
  updateTestDriveBooking,
} from '../controllers/testDriveBookingsController.js';

const router = Router();
router.use(resourceScope('bookings'));

router.get('/', listTestDriveBookings);
router.post('/', requireRoles(...WEB_OPERATION_ROLES), createTestDriveBooking);
router.get('/:id', requireScopedRecord('bookings'), getTestDriveBookingById);
router.patch('/:id', requireRoles(...WEB_OPERATION_ROLES), requireScopedRecord('bookings'), updateTestDriveBooking);
router.delete('/:id', requireRoles(...WEB_OPERATION_ROLES), requireScopedRecord('bookings'), deleteTestDriveBooking);

export default router;
