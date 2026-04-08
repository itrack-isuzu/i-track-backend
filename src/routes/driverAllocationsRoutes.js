import { Router } from 'express';

import {
  createDriverAllocation,
  deleteDriverAllocation,
  getDriverAllocationById,
  listDriverAllocations,
  updateDriverAllocation,
  updateDriverAllocationLiveLocation,
} from '../controllers/driverAllocationsController.js';

const router = Router();

router.get('/', listDriverAllocations);
router.post('/', createDriverAllocation);
router.patch('/:id/live-location', updateDriverAllocationLiveLocation);
router.get('/:id', getDriverAllocationById);
router.patch('/:id', updateDriverAllocation);
router.delete('/:id', deleteDriverAllocation);

export default router;
