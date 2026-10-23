import { Router } from 'express';
import { MANAGEMENT_ROLES, requireRoles, requireScopedRecord, resourceScope } from '../middleware/operationAccess.js';

import {
  createUnitAgentAllocation,
  deleteUnitAgentAllocation,
  getUnitAgentAllocationById,
  listUnitAgentAllocations,
  updateUnitAgentAllocation,
} from '../controllers/unitAgentAllocationsController.js';

const router = Router();
router.use(resourceScope('unitAllocations'));

router.get('/', listUnitAgentAllocations);
router.post('/', requireRoles(...MANAGEMENT_ROLES), createUnitAgentAllocation);
router.get('/:id', requireScopedRecord('unitAllocations'), getUnitAgentAllocationById);
router.patch('/:id', requireRoles(...MANAGEMENT_ROLES), updateUnitAgentAllocation);
router.delete('/:id', requireRoles(...MANAGEMENT_ROLES), deleteUnitAgentAllocation);

export default router;
