import { Router } from 'express';

import {
  createDriverAllocation,
  deleteDriverAllocation,
  getDriverAllocationById,
  listDriverAllocations,
  updateDriverAllocation,
} from '../controllers/driverAllocationsController.js';

const router = Router();

router.get('/', listDriverAllocations);
router.post('/', createDriverAllocation);
router.get('/:id', getDriverAllocationById);
router.patch('/:id', updateDriverAllocation);
router.delete('/:id', deleteDriverAllocation);

export default router;
