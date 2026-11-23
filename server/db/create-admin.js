// Creates the first admin account:
//   ADMIN_EMAIL=you@x.com ADMIN_PHONE=9876543210 ADMIN_PASSWORD='long-secret' npm run admin:create
import bcrypt from 'bcrypt';
import { env } from '../src/config/env.js';
import { pool } from '../src/config/db.js';
import { normalizePhone } from '../src/utils/phone.js';

const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
const phone = normalizePhone(process.env.ADMIN_PHONE);
const password = process.env.ADMIN_PASSWORD ?? '';

if (!email.includes('@') || !phone || password.length < 10) {
  console.error('❌ Set ADMIN_EMAIL, ADMIN_PHONE (10-digit) and ADMIN_PASSWORD (min 10 chars).');
  process.exit(1);
}
try {
  const hash = await bcrypt.hash(password, env.bcryptRounds);
  const { rowCount } = await pool.query(
    `INSERT INTO users (role, email, phone, password_hash) VALUES ('admin', $1, $2, $3) ON CONFLICT DO NOTHING`,
    [email, phone, hash]
  );
  console.log(rowCount ? `✅ Admin created: ${email}` : 'ℹ️  An admin with this email/phone already exists.');
} catch (err) {
  console.error('❌ Failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
