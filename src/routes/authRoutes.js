import { Router } from 'express';

import {
  changePassword,
  login,
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  verifyPasswordResetOtp,
} from '../controllers/authController.js';

const router = Router();

router.post('/login', login);
router.post('/change-password', changePassword);
router.post('/forgot-password/request-otp', requestPasswordResetOtp);
router.post('/forgot-password/verify-otp', verifyPasswordResetOtp);
router.post('/forgot-password/reset', resetPasswordWithOtp);

export default router;
