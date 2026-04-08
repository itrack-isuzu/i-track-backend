import { Router } from 'express';

import {
  createUser,
  deleteUser,
  getUserById,
  listUserAuditEvents,
  listUsers,
  updateUser,
} from '../controllers/usersController.js';

const router = Router();

router.get('/', listUsers);
router.get('/audit-events', listUserAuditEvents);
router.post('/', createUser);
router.get('/:id', getUserById);
router.patch('/:id', updateUser);
router.delete('/:id', deleteUser);

export default router;
