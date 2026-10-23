import { Router } from 'express';
import { MANAGEMENT_ROLES, requireRoles } from '../middleware/operationAccess.js';

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
router.post('/', requireRoles(...MANAGEMENT_ROLES), createUser);
router.get('/:id', getUserById);
router.patch('/:id', updateUser);
router.delete('/:id', requireRoles(...MANAGEMENT_ROLES), deleteUser);

export default router;
