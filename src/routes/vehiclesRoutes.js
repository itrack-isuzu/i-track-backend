import { Router } from 'express';

import {
  createVehicle,
  deleteVehicle,
  getVehicleById,
  listVehicles,
  updateVehicle,
} from '../controllers/vehiclesController.js';

const router = Router();

router.get('/', listVehicles);
router.post('/', createVehicle);
router.get('/:id', getVehicleById);
router.patch('/:id', updateVehicle);
router.delete('/:id', deleteVehicle);

export default router;
