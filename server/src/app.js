import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import meRoutes from './routes/me.routes.js';
import patientRoutes from './routes/patient.routes.js';
import pharmacyRoutes from './routes/pharmacy.routes.js';
import storesRoutes from './routes/stores.routes.js';
import prescriptionRoutes from './routes/prescription.routes.js';
import orderRoutes from './routes/order.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import { getPolicy } from './controllers/me.controller.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { apiLimiter, sameOriginGuard, writeLimiter } from './middleware/security.js';
import { requestContext, requestLogger } from './middleware/requestContext.js';
import { openapi } from './docs/openapi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');

const app = express();

app.set('trust proxy', 1);
// Behind Render's proxy, rate limiting and `secure` cookies need the forwarded protocol.
app.use(requestContext);
app.use(requestLogger);
app.use(
  helmet({
    // The SPA is served by this same app in production, so its CSP must allow the
    // Google Maps JavaScript API that the store maps load at runtime.
    contentSecurityPolicy: env.isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", 'https://maps.googleapis.com', 'https://maps.gstatic.com'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
            imgSrc: [
              "'self'",
              'data:',
              'blob:',
              'https://maps.gstatic.com',
              'https://maps.googleapis.com',
              'https://*.googleapis.com',
              'https://*.gstatic.com',
              'https://*.ggpht.com',
            ],
            connectSrc: ["'self'", 'https://maps.googleapis.com', 'https://*.googleapis.com'],
            frameSrc: ["'self'", 'https://www.google.com', 'https://maps.google.com'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
          },
        }
      : false,
  })
);
app.use(
  // Dynamic options: the SPA calls the API from the same host, which must work behind
  // Render's proxy (Host header) without listing every deployment URL in CLIENT_ORIGIN.
  cors((req, callback) => {
    const origin = req.header('Origin');
    const host = req.get('host');
    let sameOrigin = false;
    try {
      sameOrigin = Boolean(origin) && Boolean(host) && new URL(origin).host === host;
    } catch {
      sameOrigin = false;
    }
    // `credentials` lets a separately hosted SPA send the httpOnly session cookie.
    callback(null, { origin: !origin || sameOrigin || env.isAllowedOrigin(origin), credentials: true });
  })
);
app.use(express.json({ limit: '100kb' }));
app.use('/api', sameOriginGuard);
app.use('/api', apiLimiter);
// Writes get a tighter bucket than reads, without a second limiter on GETs.
app.use('/api', (req, res, next) =>
  ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : writeLimiter(req, res, next)
);

// Liveness: answers without touching the database (the platform restarts on repeated failure).
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString(), uptimeSeconds: Math.round(process.uptime()) })
);
// Readiness: proves the database connection works before traffic is routed here.
app.get('/api/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});
// Machine-readable API description (import into Postman/Insomnia or any OpenAPI viewer).
app.get('/api/openapi.json', (_req, res) => {
  res.json(openapi);
});
// Public: lets the patient app render a live Google map when a browser key exists.
app.get('/api/config/maps', (_req, res) =>
  res.json({
    browserKey: env.googleMapsBrowserKey ?? null,
    serverConfigured: Boolean(env.googleMapsKey),
    available: Boolean(env.googleMapsBrowserKey || env.googleMapsKey),
  })
);
app.get('/api/privacy/policy', getPolicy); // public, shown on the sign-up screens

app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/pharmacies', pharmacyRoutes);
app.use('/api/stores', storesRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/notifications', notificationRoutes);

// Production hosting: one origin serves both the API and the built React app.
if (env.serveClient) {
  if (!fs.existsSync(path.join(clientDist, 'index.html'))) {
    console.warn(`⚠️  SERVE_CLIENT is on but ${clientDist}/index.html is missing. Run the client build first.`);
  }
  app.use(
    express.static(clientDist, {
      index: false,
      // Vite writes content-hashed asset names, so they can be cached hard; HTML must not be.
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );
  // Any non-API GET falls through to the SPA, whose own router picks the page.
  app.get(/^\/(?!api\/).*/, (_req, res, next) => {
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
}

app.use(notFound);
app.use(errorHandler);

export default app;
