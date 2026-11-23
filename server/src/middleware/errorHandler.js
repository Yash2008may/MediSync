import { env } from '../config/env.js';

export const notFound = (req, res) =>
  res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.originalUrl}` } });

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err.name === 'MulterError') {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({ error: { message: tooBig ? 'File too large (max 5 MB)' : err.message } });
  }

  // PostgreSQL unique violation
  if (err.code === '23505') {
    const c = err.constraint ?? '';
    let message = 'An account with these details already exists.';
    if (c.includes('email')) message = 'An account with this email already exists.';
    else if (c.includes('phone')) message = 'An account with this mobile number already exists.';
    else if (c.includes('license')) message = 'This drug licence number is already registered.';
    return res.status(409).json({ error: { message } });
  }

  const status = err.status ?? 500;
  if (status >= 500) console.error(err);

  res.status(status).json({
    error: {
      message: status >= 500 && env.isProd ? 'Something went wrong' : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  });
}
