import { Router } from 'express';

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

router.get('/', listPreparations);
router.post('/', createPreparation);
router.get('/eta-model', getPreparationEtaModel);
router.post('/retrain-eta', retrainPreparationEta);
router.get('/:id', getPreparationById);
router.patch('/:id', updatePreparation);
router.delete('/:id', deletePreparation);

export default router;
