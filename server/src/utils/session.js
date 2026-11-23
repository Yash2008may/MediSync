import { env } from '../config/env.js';

// The browser session is an httpOnly cookie so page scripts cannot read the token.
// Bearer tokens are still accepted for scripts and API tests.
export const SESSION_COOKIE = 'medisync_session';

const cookieOptions = () => ({
  httpOnly: true,
  // Top-level hosting (local at localhost, production on Render) uses Lax. An embedded
  // cross-site preview needs a partitioned cookie (CHIPS) or the browser drops it.
  sameSite: env.cookiePartitioned ? 'none' : 'lax',
  secure: env.isProd || env.cookiePartitioned,
  ...(env.cookiePartitioned ? { partitioned: true } : {}),
  path: '/',
  maxAge: env.sessionCookieDays * 24 * 60 * 60 * 1000,
});

export const setSessionCookie = (res, token) => res.cookie(SESSION_COOKIE, token, cookieOptions());

export const clearSessionCookie = (res) => {
  const { maxAge, ...rest } = cookieOptions();
  res.clearCookie(SESSION_COOKIE, rest);
};

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return rest.join('=');
      }
    }
  }
  return null;
}
