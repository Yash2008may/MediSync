import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { loginLimiter, otpLimiter, registerLimiter } from '../middleware/security.js';
import {
  adminRegisterSchema,
  forgotPasswordSchema,
  loginSchema,
  patientRegisterSchema,
  pharmacyRegisterSchema,
  resetPasswordSchema,
  verifyOtpSchema,
} from '../validators/auth.validators.js';
import * as auth from '../controllers/auth.controller.js';

const router = Router();

// Patient
router.post('/patient/register', registerLimiter, validate(patientRegisterSchema), auth.registerPatient);
router.post('/patient/login', loginLimiter, validate(loginSchema), auth.loginPatient);

// Pharmacy / Medical store
router.post('/pharmacy/register', registerLimiter, validate(pharmacyRegisterSchema), auth.registerPharmacy);
router.post('/pharmacy/login', loginLimiter, validate(loginSchema), auth.loginPharmacy);

// Admin. Sign-up is allowed exactly once, to bootstrap the first admin account;
// after that new admins can only be created by an existing admin or `npm run admin:create`.
router.get('/admin/bootstrap', auth.adminBootstrapState);
router.post('/admin/register', registerLimiter, validate(adminRegisterSchema), auth.registerAdmin);
router.post('/admin/login', loginLimiter, validate(loginSchema), auth.loginAdmin);

// Forgot-password OTP recovery (both roles)
router.post('/forgot-password', otpLimiter, validate(forgotPasswordSchema), auth.forgotPassword);
router.post('/verify-otp', otpLimiter, validate(verifyOtpSchema), auth.verifyOtp);
router.post('/reset-password', otpLimiter, validate(resetPasswordSchema), auth.resetPassword);

router.get('/me', requireAuth, auth.me);
router.post('/logout', auth.logout);

export default router;
