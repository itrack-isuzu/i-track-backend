import { Router } from 'express';
import { MANAGEMENT_ROLES, WEB_OPERATION_ROLES, requireRoles, requireScopedRecord, resourceScope } from '../middleware/operationAccess.js';

import {
  createPreparation,
  deletePreparation,
  getPreparationEtaModel,
  getPreparationById,
  listPreparations,
  retrainPreparationEta,
  updatePreparation,
} from '../controllers/preparationsController.js';

const router = Router();
router.use(resourceScope('preparations'));

router.get('/', listPreparations);
router.post('/', requireRoles(...WEB_OPERATION_ROLES), createPreparation);
router.get('/eta-model', getPreparationEtaModel);
router.post('/retrain-eta', requireRoles('admin'), retrainPreparationEta);
router.get('/:id', requireScopedRecord('preparations'), getPreparationById);
router.patch('/:id', requireRoles(...WEB_OPERATION_ROLES, 'dispatcher'), requireScopedRecord('preparations'), updatePreparation);
router.delete('/:id', requireRoles(...WEB_OPERATION_ROLES), requireScopedRecord('preparations'), deletePreparation);

export default router;
