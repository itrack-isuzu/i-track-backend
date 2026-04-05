import { Router } from 'express';

import {
  createUnitAgentAllocation,
  deleteUnitAgentAllocation,
  getUnitAgentAllocationById,
  listUnitAgentAllocations,
  updateUnitAgentAllocation,
} from '../controllers/unitAgentAllocationsController.js';

const router = Router();

router.get('/', listUnitAgentAllocations);
router.post('/', createUnitAgentAllocation);
router.get('/:id', getUnitAgentAllocationById);
router.patch('/:id', updateUnitAgentAllocation);
router.delete('/:id', deleteUnitAgentAllocation);

export default router;
