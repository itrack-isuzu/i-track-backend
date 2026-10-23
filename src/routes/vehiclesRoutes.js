import { Router } from 'express';
import { MANAGEMENT_ROLES, guardVehicleDeletion, guardVehicleStatusUpdate, requireRoles, requireScopedRecord, resourceScope } from '../middleware/operationAccess.js';

import {
  createVehicle,
  deleteVehicle,
  getVehicleById,
  listVehicles,
  updateVehicle,
} from '../controllers/vehiclesController.js';

const router = Router();
router.use(resourceScope('vehicles'));

router.get('/', listVehicles);
router.post('/', requireRoles(...MANAGEMENT_ROLES), createVehicle);
router.get('/:id', requireScopedRecord('vehicles'), getVehicleById);
router.patch('/:id', requireRoles(...MANAGEMENT_ROLES), guardVehicleStatusUpdate, updateVehicle);
router.delete('/:id', requireRoles(...MANAGEMENT_ROLES), guardVehicleDeletion, deleteVehicle);

export default router;
