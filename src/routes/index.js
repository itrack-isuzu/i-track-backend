import { Router } from 'express';
import mongoose from 'mongoose';

import authRoutes from './authRoutes.js';
import driverAllocationsRoutes from './driverAllocationsRoutes.js';
import notificationsRoutes from './notificationsRoutes.js';
import preparationsRoutes from './preparationsRoutes.js';
import setupRoutes from './setupRoutes.js';
import testDriveBookingsRoutes from './testDriveBookingsRoutes.js';
import unitAgentAllocationsRoutes from './unitAgentAllocationsRoutes.js';
import usersRoutes from './usersRoutes.js';
import vehiclesRoutes from './vehiclesRoutes.js';
import { sendSuccess } from '../utils/apiResponse.js';

const router = Router();

const databaseStateByCode = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

router.get('/health', (req, res) => {
  void req;

  sendSuccess(res, {
    message: 'I-TRACK backend is running.',
    data: {
      service: 'i-track-backend',
      database: databaseStateByCode[mongoose.connection.readyState] ?? 'unknown',
    },
  });
});

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/vehicles', vehiclesRoutes);
router.use('/driver-allocations', driverAllocationsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/unit-agent-allocations', unitAgentAllocationsRoutes);
router.use('/preparations', preparationsRoutes);
router.use('/test-drive-bookings', testDriveBookingsRoutes);
router.use('/setup', setupRoutes);

export default router;
