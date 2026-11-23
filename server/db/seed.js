// Demo accounts for local development. Run it after a reset:
//   npm run db:reset && npm run db:seed      (or: npm run db:setup)
//
// Idempotent: re-running updates the demo passwords and profiles in place.
// The admin account keeps the one-time rule: it is only created while no admin
// exists on the deployment, so seeding never bypasses the admin bootstrap.
import bcrypt from 'bcrypt';
import { env } from '../src/config/env.js';
import { pool, withTransaction } from '../src/config/db.js';

if (env.isProd) {
  console.error('❌ db:seed is disabled when NODE_ENV=production');
  process.exit(1);
}

export const DEMO_PATIENT = {
  role: 'patient',
  email: 'patient@medisync.demo',
  phone: '9876500001',
  password: 'Patient@123',
  name: 'Ananya Sharma',
  address: '12th Main Road, Indiranagar, Bengaluru 560038',
  homeLat: 12.9719,
  homeLng: 77.6412,
};

export const DEMO_PHARMACY = {
  role: 'pharmacy',
  email: 'pharmacy@medisync.demo',
  phone: '9876500002',
  password: 'Pharmacy@123',
  storeName: 'MediSync Demo Pharmacy',
  licenseNumber: 'KA-DEMO-1001',
  address: '100 Feet Road, Indiranagar, Bengaluru 560038',
  latitude: 12.9719,
  longitude: 77.6412,
  pharmacistName: 'Rahul Nair',
  pharmacistRegNo: 'KA-PH-77821',
};

export const DEMO_ADMIN = {
  role: 'admin',
  email: 'admin@medisync.demo',
  phone: '9876500003',
  password: 'Admin@12345',
};

// Upserts by (role, lower(email)) so re-seeding is safe.
async function upsertUser(c, { role, email, phone, password }) {
  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
  const { rows } = await c.query(
    `INSERT INTO users (role, email, phone, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (role, lower(email)) DO UPDATE
       SET phone = EXCLUDED.phone,
           password_hash = EXCLUDED.password_hash,
           is_active = TRUE,
           updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [role, email, phone, passwordHash]
  );
  return rows[0];
}

async function seedPatient(c, account) {
  const user = await upsertUser(c, account);
  await c.query(
    `INSERT INTO patients (user_id, name, address, home_lat, home_lng, timezone, notify_sms, notify_email)
     VALUES ($1, $2, $3, $4, $5, 'Asia/Kolkata', TRUE, TRUE)
     ON CONFLICT (user_id) DO UPDATE
       SET name = EXCLUDED.name, address = EXCLUDED.address,
           home_lat = EXCLUDED.home_lat, home_lng = EXCLUDED.home_lng`,
    [user.id, account.name, account.address, account.homeLat, account.homeLng]
  );
  for (const type of ['privacy_policy', 'health_data_processing']) {
    const { rows } = await c.query(
      'SELECT 1 FROM user_consents WHERE user_id = $1 AND type = $2 LIMIT 1',
      [user.id, type]
    );
    if (!rows[0]) {
      await c.query('INSERT INTO user_consents (user_id, type, granted, version) VALUES ($1, $2, TRUE, $3)', [
        user.id,
        type,
        'demo-seed',
      ]);
    }
  }
  return user;
}

// The demo store's orderable price list. Patients can only order from a pharmacy's
// catalogue, and the server quotes these prices — so a usable demo needs real rows.
const DEMO_CATALOGUE = [
  { name: 'Atorvastatin 20mg', brand: 'Lipitor', packSize: '30 tablets', mrp: 320, discount: 18, stock: 24, scheduleH: true },
  { name: 'Metformin SR 500mg', brand: 'Glycomet', packSize: '60 tablets', mrp: 210, discount: 15, stock: 9, scheduleH: true },
  { name: 'Dolo 650mg', brand: 'Micro Labs', packSize: '15 tablets', mrp: 45, discount: 12, stock: 40, scheduleH: false },
  { name: 'Telma 40mg', brand: 'Glenmark', packSize: '30 tablets', mrp: 190, discount: 20, stock: 31, scheduleH: true },
  { name: 'Amoxicillin 500mg', brand: 'Mox', packSize: '10 capsules', mrp: 120, discount: 10, stock: 6, scheduleH: true },
  { name: 'Pantoprazole 40mg', brand: 'Pan 40', packSize: '15 tablets', mrp: 150, discount: 22, stock: 18, scheduleH: false },
];

async function seedCatalogue(c, pharmacyId) {
  for (const item of DEMO_CATALOGUE) {
    await c.query(
      `INSERT INTO pharmacy_inventory
         (pharmacy_id, medicine_name, brand, pack_size, mrp, discount_pct, stock_qty, is_schedule_h)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (pharmacy_id, medicine_name) DO UPDATE
         SET brand = EXCLUDED.brand, pack_size = EXCLUDED.pack_size, mrp = EXCLUDED.mrp,
             discount_pct = EXCLUDED.discount_pct, stock_qty = EXCLUDED.stock_qty,
             is_schedule_h = EXCLUDED.is_schedule_h`,
      [pharmacyId, item.name, item.brand, item.packSize, item.mrp, item.discount, item.stock, item.scheduleH]
    );
  }
}

async function seedPharmacy(c, account) {
  const user = await upsertUser(c, account);
  // Always approved here: this is the demo partner store that makes the patient's
  // nearby list show a real MediSync pharmacy without a Google Maps key.
  await c.query(
    `INSERT INTO pharmacies
       (user_id, store_name, license_number, address, latitude, longitude, verification_status,
        verified_at, verification_note, pharmacist_name, pharmacist_reg_no)
     VALUES ($1, $2, $3, $4, $5, $6, 'approved', now(), 'Demo seed', $7, $8)
     ON CONFLICT (user_id) DO UPDATE
       SET store_name = EXCLUDED.store_name, license_number = EXCLUDED.license_number,
           address = EXCLUDED.address, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
           verification_status = 'approved', verified_at = now(),
           verification_note = 'Demo seed',
           pharmacist_name = EXCLUDED.pharmacist_name, pharmacist_reg_no = EXCLUDED.pharmacist_reg_no`,
    [
      user.id,
      account.storeName,
      account.licenseNumber,
      account.address,
      account.latitude,
      account.longitude,
      account.pharmacistName,
      account.pharmacistRegNo,
    ]
  );
  return user;
}

// The first admin is bootstrapped exactly once; seeding will not add another.
async function seedAdmin(c, account) {
  const { rows } = await c.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (rows[0]) return { created: false };
  await upsertUser(c, account);
  return { created: true };
}

try {
  const result = await withTransaction(async (c) => {
    const patient = await seedPatient(c, DEMO_PATIENT);
    const pharmacy = await seedPharmacy(c, DEMO_PHARMACY);
    await seedCatalogue(c, pharmacy.id);
    const admin = await seedAdmin(c, DEMO_ADMIN);
    return { patient, pharmacy, admin };
  });

  console.log('✅ Demo data seeded.');
  console.log('');
  console.log('   Patient   patient@medisync.demo    mobile 9876500001   password Patient@123');
  console.log('   Pharmacy  pharmacy@medisync.demo   licence KA-DEMO-1001, or mobile 9876500002');
  console.log('             password Pharmacy@123');
  if (result.admin.created) {
    console.log('   Admin     admin@medisync.demo      mobile 9876500003   password Admin@12345');
    console.log('             (created now — the one-time admin sign-up is closed from here on)');
  } else {
    console.log('   Admin     already exists on this database, so no demo admin was added.');
    console.log('             Sign in with the existing admin, or run npm run db:reset && npm run db:seed.');
  }
  console.log('');
  console.log('   The demo pharmacy is approved and sits at Indiranagar, Bengaluru — it appears in');
  console.log('   the patient map even when GOOGLE_MAPS_SERVER_KEY is not set, and its price list');
  console.log('   has 6 medicines the patient can order from.');
} catch (err) {
  console.error('❌ Seed failed:', err.message);
  if (err.code === '42P01') console.error('   Run `npm run db:reset` first to create the schema.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
