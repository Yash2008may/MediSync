import crypto from 'node:crypto';

// Correlates a request across logs and lets a support report quote one id.
export function requestContext(req, res, next) {
  req.id = req.get('X-Request-Id')?.slice(0, 100) || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

// One structured line per request. Query strings are dropped so reset tokens never land in logs.
export function requestLogger(req, res, next) {
  if (req.path === '/api/health' || req.path === '/api/ready') return next();
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const line = {
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Number(ms.toFixed(1)),
      userId: req.user?.id ?? null,
    };
    const out = JSON.stringify(line);
    if (line.level === 'error') console.error(out);
    else if (line.level === 'warn') console.warn(out);
    else console.log(out);
  });
  next();
}
