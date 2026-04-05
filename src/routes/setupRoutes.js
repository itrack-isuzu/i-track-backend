import { Router } from 'express';

import { seedDatabase } from '../controllers/setupController.js';

const router = Router();

router.post('/seed', seedDatabase);

export default router;
