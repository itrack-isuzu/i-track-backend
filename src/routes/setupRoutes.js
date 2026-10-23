import { Router } from 'express';
import { requireRoles } from '../middleware/operationAccess.js';

import { seedDatabase } from '../controllers/setupController.js';

const router = Router();

router.post('/seed', requireRoles('admin'), seedDatabase);

export default router;
