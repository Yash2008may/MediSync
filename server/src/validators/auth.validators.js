import { z } from 'zod';
import { normalizePhone } from '../utils/phone.js';

const phone = z
  .string({ required_error: 'Mobile number is required' })
  .transform((v) => normalizePhone(v))
  .refine((v) => v !== null, 'Enter a valid 10-digit Indian mobile number');

const email = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Enter a valid email address');

// bcrypt only uses the first 72 bytes, so cap at 72.
const password = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

const timezone = z
  .string()
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid timezone')
  .optional();

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const role = z.enum(['patient', 'pharmacy']);
const resetRole = z.enum(['patient', 'pharmacy', 'admin']);

const mustAccept = (message) => z.literal(true, { errorMap: () => ({ message }) });

export const patientRegisterSchema = z.object({
  name: z.string().trim().min(2, 'Full name is required').max(100),
  phone,
  email,
  address: z.string().trim().min(5, 'Enter your full home address').max(300),
  password,
  homeLat: lat.optional(),
  homeLng: lng.optional(),
  timezone,
  consents: z.object(
    {
      privacyPolicy: mustAccept('You must accept the Privacy Policy'),
      healthData: mustAccept('Consent to process your health data is required to use MediSync'),
      notifications: z.boolean().default(false), // SMS + email reminders
    },
    { required_error: 'Consent is required' }
  ),
});

export const pharmacyRegisterSchema = z.object({
  storeName: z.string().trim().min(2, 'Store name is required').max(120),
  licenseNumber: z
    .string()
    .trim()
    .min(5, 'Enter a valid drug licence number')
    .max(40)
    .regex(/^[A-Za-z0-9\-\/ ]+$/, 'Licence number has invalid characters'),
  email,
  phone,
  address: z.string().trim().min(5, 'Enter the full store address').max(300),
  password,
  // Resolved on the client with Google Maps (Geocoding / Places) during "Verify on Map"
  latitude: lat,
  longitude: lng,
  placeId: z.string().trim().max(200).optional(),
  pharmacistName: z.string().trim().min(2).max(100).optional(),
  pharmacistRegNo: z.string().trim().min(3).max(40).optional(),
  consents: z.object(
    { privacyPolicy: mustAccept('You must accept the Privacy Policy') },
    { required_error: 'Consent is required' }
  ),
});

// One-time admin bootstrap. It creates the very first admin account only; the
// server refuses once any admin exists so the console cannot be self-served later.
export const adminRegisterSchema = z.object({
  email,
  phone,
  password: z
    .string({ required_error: 'Password is required' })
    .min(10, 'Admin password must be at least 10 characters')
    .max(72, 'Password must be at most 72 characters')
    .regex(/[A-Za-z]/, 'Password must contain a letter')
    .regex(/[0-9]/, 'Password must contain a number'),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email / mobile / licence number').max(120),
  password: z.string().min(1, 'Password is required').max(72),
});

export const forgotPasswordSchema = z.object({
  role: resetRole,
  identifier: z.string().trim().min(3).max(120),
});

export const verifyOtpSchema = z.object({
  role: resetRole,
  identifier: z.string().trim().min(3).max(120),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

export const resetPasswordSchema = z.object({
  resetToken: z.string().min(10),
  newPassword: password,
});
