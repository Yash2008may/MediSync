import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { SESSION_COOKIE, readCookie } from '../utils/session.js';

// ------------------------------------------------------------------ CSRF
// Cookie-authenticated writes are only accepted from this same host. Bearer requests carry
// no ambient credential, so they are unaffected. SameSite=Lax already blocks cross-site
// POSTs in modern browsers; this is the server-side backstop.
export function sameOriginGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!readCookie(req, SESSION_COOKIE)) return next();

  const source = req.get('origin') || req.get('referer');
  if (!source) return next(); // curl / non-browser client sending the cookie explicitly
  try {
    const originHost = new URL(source).host;
    const sameHost =
      originHost === req.get('host') ||
      originHost === req.get('x-forwarded-host') ||
      // The Vite dev proxy rewrites Host to the API target; an origin already allowed by
      // CORS (CLIENT_ORIGIN, preview hosts) is trusted for cookie writes too.
      env.isAllowedOrigin(source);
    if (!sameHost) {
      return next(new AppError(403, 'Cross-site request blocked. Reload MediSync and try again.'));
    }
  } catch {
    return next(new AppError(403, 'Invalid request origin'));
  }
  return next();
}

// ------------------------------------------------------------- RATE LIMITS
const message = (text) => ({ error: { message: text } });

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.rateLimit.api,
  standardHeaders: true,
  legacyHeaders: false,
  message: message('Too many requests. Wait a few minutes and try again.'),
  skip: (req) => req.path === '/api/health' || req.path === '/api/ready',
});

export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.rateLimit.write,
  standardHeaders: true,
  legacyHeaders: false,
  message: message('Too many changes at once. Wait a minute and try again.'),
});

// Login attempts are counted per IP *and* identifier, so one account cannot be brute-forced
// from a rotating IP and one IP cannot spray many accounts.
const loginKey = (req) => `${req.ip}:${String(req.body?.identifier ?? '').toLowerCase()}`;

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.rateLimit.auth,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: loginKey,
  message: message('Too many login attempts. Try again in 15 minutes.'),
});

export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Math.max(env.rateLimit.auth, 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: message('Too many OTP requests. Try again in 15 minutes.'),
});

export const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.rateLimit.auth,
  standardHeaders: true,
  legacyHeaders: false,
  message: message('Too many sign-up attempts. Try again later.'),
});
