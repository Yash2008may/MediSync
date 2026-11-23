import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../config/db.js';
import { AppError, asyncHandler } from '../utils/AppError.js';
import { SESSION_COOKIE, readCookie } from '../utils/session.js';

export const requireAuth = asyncHandler(async (req, _res, next) => {
  // The browser sends the httpOnly session cookie. Scripts and API tests may send a
  // Bearer token instead; a token in the header wins so a stale cookie cannot shadow it.
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : readCookie(req, SESSION_COOKIE);
  if (!token) throw new AppError(401, 'Authentication required');

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new AppError(401, 'Session expired or invalid. Please log in again.');
  }
  if (payload.purpose) throw new AppError(401, 'Invalid token'); // reset tokens are not login tokens

  const { rows } = await query(
    'SELECT id, role, email, phone, is_active, password_changed_at FROM users WHERE id = $1',
    [payload.sub]
  );
  const user = rows[0];
  if (!user || !user.is_active) throw new AppError(401, 'Account not found or disabled');

  // Tokens issued before a password reset are no longer valid
  if (Math.floor(new Date(user.password_changed_at).getTime() / 1000) > payload.iat) {
    throw new AppError(401, 'Password was changed. Please log in again.');
  }

  req.user = user;
  next();
});

export const requireRole =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : next(new AppError(403, 'You do not have access to this resource'));
