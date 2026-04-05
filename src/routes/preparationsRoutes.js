import { Router } from 'express';

import {
  createPreparation,
  deletePreparation,
  getPreparationById,
  listPreparations,
  updatePreparation,
} from '../controllers/preparationsController.js';

const router = Router();

router.get('/', listPreparations);
router.post('/', createPreparation);
router.get('/:id', getPreparationById);
router.patch('/:id', updatePreparation);
router.delete('/:id', deletePreparation);

export default router;
