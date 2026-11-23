import 'dotenv/config';

const get = (key, fallback) =>
  process.env[key] !== undefined && process.env[key] !== '' ? process.env[key] : fallback;

const must = (key) => {
  const value = get(key);
  if (!value) {
    console.error(`❌ Missing required environment variable: ${key} (see .env.example)`);
    process.exit(1);
  }
  return value;
};

const nodeEnv = get('NODE_ENV', 'development');
const jwtSecret = must('JWT_SECRET');
if (nodeEnv === 'production' && jwtSecret.length < 32) {
  console.error('❌ JWT_SECRET must be at least 32 characters in production.');
  process.exit(1);
}

const autoVerifyPharmacies = get('AUTO_VERIFY_PHARMACIES', 'false') === 'true';
if (nodeEnv === 'production' && autoVerifyPharmacies) {
  console.error('❌ AUTO_VERIFY_PHARMACIES must be false in production (licences must be checked by an admin).');
  process.exit(1);
}

// Optional AES-256-GCM key for prescription files at rest. 64 hex characters (32 bytes).
// When unset, files are stored as uploaded (the disk itself must then be encrypted).
const fileEncryptionKey = get('FILE_ENCRYPTION_KEY');
if (fileEncryptionKey && !/^[0-9a-f]{64}$/i.test(fileEncryptionKey)) {
  console.error('❌ FILE_ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate one with:`\n   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const clientOrigins = get('CLIENT_ORIGIN', 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Preview/restore hosts change, so match them instead of listing each one in CLIENT_ORIGIN.
// Style.dev preview domains are per-chat; loopback ports vary per dev run.
const allowPreviewOrigins = get('ALLOW_PREVIEW_ORIGINS', nodeEnv === 'production' ? 'false' : 'true') === 'true';
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.style\.dev$/i;
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/i;

const isAllowedOrigin = (origin) => {
  if (!origin) return true; // same-origin / curl requests send no Origin header
  if (clientOrigins.includes(origin)) return true;
  if (!allowPreviewOrigins) return false;
  return PREVIEW_ORIGIN.test(origin) || LOOPBACK_ORIGIN.test(origin);
};

export const env = {
  autoVerifyPharmacies,
  allowPreviewOrigins,
  isAllowedOrigin,
  googleMapsKey: get('GOOGLE_MAPS_SERVER_KEY'),
  // Browser key used to render the map on the patient side (restrict it by HTTP referrer).
  googleMapsBrowserKey: get('GOOGLE_MAPS_BROWSER_KEY'),
  // Keyless place lookup used when Google Maps is not configured (or cannot resolve a name).
  geocoder: {
    nominatim: get('GEOCODER_NOMINATIM', 'true') === 'true',
    userAgent: get('GEOCODER_USER_AGENT', 'MediSync/1.0 (demo pharmacy app)'),
  },
  geo: {
    nearbyRadiusMeters: Number(get('NEARBY_RADIUS_METERS', '5000')),
    maxAccuracyMeters: Number(get('GEO_MAX_ACCURACY_METERS', '2000')),
  },
  uploadDir: get('UPLOAD_DIR', './uploads'),
  prescriptionValidDays: Number(get('PRESCRIPTION_DEFAULT_VALID_DAYS', '30')),
  fileEncryptionKey,
  // Health-data retention: prescription files for finished orders are removed after this.
  retentionDays: Number(get('PRESCRIPTION_RETENTION_DAYS', '180')),
  notificationRetentionDays: Number(get('NOTIFICATION_RETENTION_DAYS', '90')),
  // Daily health-data cleanup inside the web process; set to "off" to disable.
  retentionCron: get('RETENTION_CRON', '0 3 * * *'),
  // Session cookie (httpOnly) is the primary credential; Bearer tokens still work for scripts.
  sessionCookieDays: Number(get('SESSION_COOKIE_DAYS', '7')),
  // Only for previews embedded in a cross-site iframe (Freebuff's Browser panel). Chrome
  // drops ordinary third-party cookies there; a partitioned cookie keeps the login alive,
  // at the cost of older browsers rejecting it. Leave off for normal top-level hosting.
  cookiePartitioned: get('COOKIE_PARTITIONED', 'false') === 'true',
  orders: {
    maxLines: Number(get('ORDER_MAX_LINES', '20')),
    pageSize: Number(get('ORDER_PAGE_SIZE', '25')),
  },
  rateLimit: {
    api: Number(get('RATE_LIMIT_API', '900')),
    write: Number(get('RATE_LIMIT_WRITE', '120')),
    auth: Number(get('RATE_LIMIT_AUTH', '20')),
    otpPerHour: Number(get('OTP_MAX_PER_HOUR', '5')),
  },
  nodeEnv,
  isProd: nodeEnv === 'production',
  // In production the API also serves the built patient/pharmacy SPA from client/dist.
  serveClient: get('SERVE_CLIENT', nodeEnv === 'production' ? 'true' : 'false') === 'true',
  port: Number(get('PORT', '5000')),
  clientOrigins,

  databaseUrl: must('DATABASE_URL'),
  dbSsl: get('DATABASE_SSL', 'false') === 'true',

  jwtSecret,
  jwtExpiresIn: get('JWT_EXPIRES_IN', '7d'),
  bcryptRounds: Number(get('BCRYPT_ROUNDS', '12')),

  otp: {
    ttlMinutes: Number(get('OTP_TTL_MINUTES', '10')),
    maxAttempts: Number(get('OTP_MAX_ATTEMPTS', '5')),
    resendCooldownSeconds: Number(get('OTP_RESEND_COOLDOWN_SECONDS', '60')),
    devLog: get('DEV_LOG_OTP', 'false') === 'true' && nodeEnv !== 'production',
  },

  smtp: {
    host: get('SMTP_HOST'),
    port: Number(get('SMTP_PORT', '587')),
    secure: get('SMTP_SECURE', 'false') === 'true',
    user: get('SMTP_USER'),
    pass: get('SMTP_PASS'),
    from: get('EMAIL_FROM', 'MediSync <no-reply@medisync.local>'),
  },

  sms: {
    provider: get('SMS_PROVIDER', 'console'), // console | fast2sms | twilio
    countryCode: get('DEFAULT_COUNTRY_CODE', '+91'),
    fast2smsKey: get('FAST2SMS_API_KEY'),
    twilio: {
      sid: get('TWILIO_ACCOUNT_SID'),
      token: get('TWILIO_AUTH_TOKEN'),
      from: get('TWILIO_FROM_NUMBER'),
    },
  },
};
