import { Router } from 'express';

import { changePassword, login } from '../controllers/authController.js';

const router = Router();

router.post('/login', login);
router.post('/change-password', changePassword);

export default router;
