// DEVELOPMENT ONLY: drops everything in the public schema and re-applies every migration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../src/config/env.js';
import { pool } from '../src/config/db.js';

if (env.isProd) {
  console.error('❌ db:reset is disabled when NODE_ENV=production');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

try {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    await pool.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
  }

  console.log(`✅ Database reset and ${files.length} migration(s) applied.`);
} catch (err) {
  console.error('❌ Reset failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
