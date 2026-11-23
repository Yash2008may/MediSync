// Data-retention job for a scheduler or one-off run:
//   npm run db:retention
//
// On Render the web service runs the same routine daily (see RETENTION_CRON), because a
// Render Cron Job cannot mount the prescription disk.
import { pool } from '../src/config/db.js';
import { runRetention } from '../src/services/retentionService.js';

try {
  const result = await runRetention();
  console.log(
    `✅ Retention done: ${result.files} prescription file(s), ${result.prescriptions} prescription record(s), ` +
      `${result.notifications} notification(s), ${result.cache} cache row(s).`
  );
} catch (error) {
  console.error('❌ Retention job failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
