// Applies every pending file in db/migrations, in filename order, exactly once.
//
// A database created before migrations existed is detected (public.users exists with no
// recorded versions) and its baseline (001) is marked as already applied, so an existing
// deployment upgrades in place instead of failing on "relation already exists".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

async function main() {
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

  if (!files.length) {
    console.log('ℹ️  No migration files found.');
    return;
  }

  const { rows } = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.version));

  if (!applied.size) {
    const legacy = await pool.query(`SELECT to_regclass('public.users') AS users`);
    if (legacy.rows[0].users) {
      const baseline = files[0].replace(/\.sql$/, '');
      await pool.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [baseline]);
      applied.add(baseline);
      console.log(`ℹ️  Existing database detected — ${baseline} marked as applied.`);
    }
  }

  let count = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await client.query('COMMIT');
      console.log(`✅ Applied ${version}`);
      count += 1;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`${version} failed: ${error.message}`);
    } finally {
      client.release();
    }
  }

  console.log(count ? `✅ ${count} migration(s) applied.` : '✅ Database already up to date.');
}

try {
  await main();
} catch (error) {
  console.error('❌ Migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
