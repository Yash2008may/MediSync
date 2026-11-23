import { env } from './config/env.js';
import { pool } from './config/db.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import cron from 'node-cron';
import app from './app.js';
import { runRetention } from './services/retentionService.js';
import { ensureScheduleTable, startReminderScheduler } from './jobs/reminderScheduler.js';

async function main() {
  await pool.query('SELECT 1');
  await ensureScheduleTable();
  startReminderScheduler(); // fail fast if the DB is unreachable
  await fs.mkdir(path.resolve(env.uploadDir, 'prescriptions'), { recursive: true });
  if (env.autoVerifyPharmacies) console.warn('⚠️  AUTO_VERIFY_PHARMACIES is ON – new pharmacies are approved without a licence check (testing only).');
  if (!env.googleMapsKey) {
    console.warn(
      '⚠️  GOOGLE_MAPS_SERVER_KEY not set – no Google shops or reverse-geocoded addresses. ' +
        (env.geocoder.nominatim
          ? 'Typed place names fall back to the built-in locality index and OpenStreetMap.'
          : 'Typed place names fall back to the built-in locality index only.')
    );
  }
  // Health-data retention. Runs in-process because a Render Cron Job cannot mount the
  // prescription disk that the files live on. The job is idempotent.
  if (env.retentionCron && env.retentionCron !== 'off' && cron.validate(env.retentionCron)) {
    cron.schedule(env.retentionCron, () => {
      runRetention()
        .then((result) =>
          console.log(
            `[retention] ${result.prescriptions} prescription(s), ${result.notifications} notification(s) removed`
          )
        )
        .catch((error) => console.error('[retention] failed:', error.message));
    });
  }

  const server = app.listen(env.port, () => {
    console.log(`✅ MediSync API running on http://localhost:${env.port}  (${env.nodeEnv})`);
  });

  const shutdown = (signal) => {
    console.log(`\n${signal} received – shutting down…`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});
