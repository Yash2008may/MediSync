# MediSync (Node/Express + PostgreSQL + React)

```
medisync/
  server/   <- schema v3 + recorded migrations, auth (httpOnly cookie sessions), admin licence
               verification, privacy/consent, live GPS + Google Maps shops, prescription upload
               (encrypted at rest), order lifecycle, pharmacy catalogue, notifications
  client/   <- React + Vite + Tailwind patient, pharmacy and admin consoles
```

## Run the client
```bash
cd client
npm install
npm run dev                     # http://localhost:3000
```
The schedule, stock, reorder checkout, order tracking and SMS/email hub run on seeded data persisted in
`localStorage` (`Reset Data` restores the seed). SMS, payments and rider positions are simulated until the server
gateways below are connected.

Default shops are **not** simulated: the page asks the browser for your real position — or uses the default
location **you saved yourself** when you pick that option — and calls `GET /api/stores/nearby` on the server. That
returns every registered partner pharmacy plus live Google Places medical stores (pharmacies and drugstores, up to
60) in the radius with real distances. The nearest three become your defaults, and the shop you select receives your
next refill (shown in checkout). The Vite dev server proxies `/api` to `VITE_API_PROXY_TARGET` (default
`http://localhost:5000`).

**Saving a default location** — nothing is hard-coded: the *My default location* card on the shops page takes a place
name plus either your current GPS fix (*Use my current location*) or typed coordinates, and stores it with
`PUT /api/patients/me/default-location`. *Default location* then looks up shops around it without asking for GPS.
When the browser blocks location, the page says so, keeps the labelled sample shops, and offers **Allow location &
retry** with instructions to re-enable it in the site settings — the prompt itself only appears from a user action.

With `GOOGLE_MAPS_BROWSER_KEY` set on the server (served publicly as `GET /api/config/maps`) the map card is a
real Google map with pins for every store and your location. The same key draws the store pin in the pharmacy
console and the verification map in the admin console, so all three roles see Google Maps. Without a key each map
falls back to a labelled plot of the same real coordinates.

### Signing in
The client opens on a role-based sign-in page (`client/src/pages/LoginPage.jsx`):

| Tab | Endpoint | Identifier | Lands on |
|---|---|---|---|
| Patient | `POST /api/auth/patient/login` | email or mobile | patient dashboard (`client/src/App.jsx`) |
| Pharmacy | `POST /api/auth/pharmacy/login` | email or drug licence number | pharmacy licence status (`pages/PharmacyPage.jsx`) |
| Admin | `POST /api/auth/admin/login` | admin email | licence-verification queue (`pages/AdminPage.jsx`) |

Each stores the returned JWT as `localStorage.medisync.authToken`. On reload it is checked with
`GET /api/auth/me` and the console for that role is restored. **Any 401 from the API on a request that carried a
token means the session is dead:** the client clears the token and returns to the sign-in page with a
"Session expired" banner (never an "invalid credentials" error). Only a 401 on the login call itself is shown as
bad credentials, and a 403 is shown as a permissions error without dropping the session. `Sign Out` removes the
token. **Continue with demo data** (patient tab only) opens the sample patient without a server or account.

### Forgot password
*Forgot password?* under the password field starts a three-step reset that works for **patient, pharmacy and admin**
accounts (and offers the dev OTP inline when `DEV_LOG_OTP=true` outside production):

1. `POST /api/auth/forgot-password {role, identifier}` — sends a 6-digit OTP to the registered email and mobile.
   The response is identical whether or not the account exists.
2. `POST /api/auth/verify-otp {role, identifier, otp}` — returns a 10-minute reset token (5 wrong attempts burns it).
3. `POST /api/auth/reset-password {resetToken, newPassword}` — sets the new password; every older token stops working
   because `password_changed_at` is bumped.

### Signing up
`POST /api/auth/patient/register` and `POST /api/auth/pharmacy/register` are exposed on the **Sign Up** tab for
patients (name, email, mobile, address, password, privacy + health-data consent) and pharmacies (store name, drug
licence, address, GPS pin from the browser or typed, pharmacist name and council registration, password). A new
store starts **pending** and only reaches the patient map after an admin approves the licence.

**Admin sign-up is a one-time bootstrap:** `GET /api/auth/admin/bootstrap` reports whether it is still available and
`POST /api/auth/admin/register` creates the first admin only. As soon as any admin exists the server refuses the
endpoint (409, serialised with an advisory lock) and the form switches to "use Sign In".

The admin console lists `GET /api/admin/pharmacies?status=pending`, shows each store on a Google map, and calls
`PATCH /api/admin/pharmacies/:id/verify` with `approved`/`rejected` (a rejection needs a reason). It can also sign a
store out with `PATCH /api/admin/pharmacies/:id/account {active:false}`: that ends the store's session on the next
request and blocks sign-in until the same endpoint is called with `active:true`. Create the first
admin either from the **Admin → Sign Up** tab (works once) or with
`ADMIN_EMAIL=... ADMIN_PHONE=... ADMIN_PASSWORD=... npm run admin:create` in `server/`, then sign in on
the Admin tab. Keep `AUTO_VERIFY_PHARMACIES=false` in production so licences are always reviewed by a human.

The dashboard's medicine/stock data is still the sample patient — only identity, shops and the auth session are
live until the medicine routes exist. Without a token, without location permission, or when
`GOOGLE_MAPS_SERVER_KEY` is unset on the server, the shops page falls back to the bundled sample shops and labels
them **Demo data** with the exact reason. It never invents a position or a distance.

## Run the server
Requires Node 20+ and PostgreSQL 13+.
```bash
cd server
cp .env.example .env            # Windows: copy .env.example .env  -> then edit it
npm install
psql -U postgres -c "CREATE DATABASE medisync;"
npm run db:reset                # fresh database from db/migrations (dev only; wipes data)
npm run db:migrate              # apply pending migrations instead, keeping data
npm run db:seed                 # demo patient + pharmacy + first admin (or: npm run db:setup)
npm run dev                     # http://localhost:5000
bash test-auth.sh               # optional smoke test (second terminal)
```
Already ran the old Step 1 schema? Run `npm run db:reset` (it drops and recreates the `public` schema).

### Demo accounts (`npm run db:seed`)
Run it after `db:reset` (or use `npm run db:setup`). Re-running is safe: profiles and passwords are updated in place.

| Role | Sign in with | Password |
|---|---|---|
| Patient | `patient@medisync.demo` or mobile `9876500001` | `Patient@123` |
| Pharmacy | `pharmacy@medisync.demo`, licence `KA-DEMO-1001`, or mobile `9876500002` | `Pharmacy@123` |
| Admin | `admin@medisync.demo` | `Admin@12345` |

The demo pharmacy is approved at Indiranagar, Bengaluru, so the map shows a real partner store even without a
Google Maps key. The admin is created only while no admin exists — seeding never bypasses the one-time bootstrap
(it prints the credentials when it creates one, and says so when an admin already exists).

### First admin (for the licence-verification screen)
The Admin → Sign Up tab in the client bootstraps the first admin once. The CLI equivalent:
```bash
ADMIN_EMAIL=you@example.com ADMIN_PHONE=9876543210 ADMIN_PASSWORD='a-long-password' npm run admin:create
# then POST /api/auth/admin/login
```
`AUTO_VERIFY_PHARMACIES=true` (default in `.env.example`) approves new pharmacies instantly for testing.
Set it to `false` for real use: pharmacies stay **pending** until an admin calls
`PATCH /api/admin/pharmacies/:id/verify`. The server refuses to start in production with it on.

## API added in this part
| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/{patient,pharmacy,admin}/login`, `/patient/register`, `/pharmacy/register` (consents required), `/admin/register` (one-time bootstrap), `GET /api/auth/admin/bootstrap`, `/forgot-password`, `/verify-otp`, `/reset-password`, `GET /me` |
| Admin | `GET /api/admin/overview` (licence + order counts, re-verification queue, audit trail), `GET /api/admin/orders?status=&pharmacyId=`, `GET /api/admin/users?role=&q=`, `PATCH /api/admin/users/:id/account {active}`, `GET /api/admin/pharmacies?status=pending|approved|rejected` (includes `isActive`, `needsReview`, coordinates), `PATCH /api/admin/pharmacies/:id/verify {decision, note}`, `PATCH /api/admin/pharmacies/:id/account {active}` (sign out / re-enable) |
| Ops | `GET /api/health` (liveness), `GET /api/ready` (database), `GET /api/openapi.json`, `POST /api/auth/logout` |
| Privacy | `GET /api/privacy/policy`, `GET/POST /api/me/consents`, `GET /api/me/export`, `DELETE /api/me {password}` |
| Live GPS | `PUT /api/patients/me/location {latitude, longitude, altitude, accuracy}` (needs `location` consent), `DELETE …/location`, `GET /api/patients/me/default-stores` |
| Patient default location | `GET /api/patients/me/default-location`, `PUT /api/patients/me/default-location {lat, lng, label}` — the location the patient saved themselves. The patient types a place name only; `POST /api/stores/geocode` turns it into coordinates |
| Stores | `GET /api/stores/nearby?lat&lng&radius&limit` (1–60), `POST /api/stores/reverse-geocode`, `POST /api/stores/geocode {address}` (place name → coordinates, no Google key needed), `GET /api/config/maps` (public: browser map key) |
| Prescriptions | `POST /api/prescriptions` (multipart: file, pharmacyId), `GET /api/prescriptions`, `GET …/:id/file`, `PATCH …/:id/review`, `DELETE …/:id` |
| Prescription orders | `POST /api/orders` (multipart: file, pharmacyId, items JSON `[{inventoryId, quantity}]`, deliveryAddress, fulfillment), `GET /api/orders?status=&limit=&offset=` (patient: own; pharmacy: incoming; admin: all), `GET /api/orders/:id` (with status history), `PATCH …/:id/accept` (reserves stock + approves the prescription), `PATCH …/:id/reject {reason}`, `PATCH …/:id/status {status: out_for_delivery|delivered}`, `PATCH …/:id/cancel {reason}` (patient) |
| Catalogue | `GET /api/pharmacies/:id/catalog` (orderable price list of a verified store), `GET/POST /api/pharmacies/me/inventory`, `PATCH/DELETE /api/pharmacies/me/inventory/:id` (pharmacy) |
| Notifications | `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all` |
| Profile | `PATCH /api/me/profile {name?, address?, storeName?, phone?}` — patients edit name/address, pharmacies edit store name/address, everyone edits the contact mobile. Every change is audited; a pharmacy name/address change flags the store for re-verification |
| Pharmacy | `PATCH /api/pharmacies/me/pharmacist` (registered pharmacist name + reg. no.) |

### How live location and default shops work
- The browser asks permission (`navigator.geolocation`) and sends exactly what the device reports. The server stores
  `null` for altitude if the device gives none, and never substitutes a default location.
- The server reverse-geocodes the position (Google Geocoding) into the **current address** used for the "Current Live GPS
  Location" checkout option; the registered home address stays a separate option.
- Each update re-picks the 3 nearest shops from registered MediSync pharmacies **and** Google Maps pharmacies
  (Places API New). Google shops are links/directions only (`canOrderInApp: false`).
- Google results are not copied into your database beyond `place_id` and coordinates; names/addresses are fetched live.

## What is server-backed
- **Prescription orders with a full lifecycle.** The patient uploads a prescription and orders from the pharmacy's
  own price list; the pharmacy accepts (reserves stock and approves the prescription), declines with a reason, or
  advances `confirmed → out_for_delivery → delivered`. The patient can cancel before dispatch, which releases the
  reserved stock. Every transition is written to `order_status_history`.
- **Server-side pricing.** The browser sends only `{inventoryId, quantity}`. Prices, discounts and Schedule H flags
  are read from `pharmacy_inventory` inside the request, so a tampered browser cannot change what is charged.
- **Notifications.** New orders, accepts, declines, dispatch, delivery and cancellations create in-app notifications
  (bell in every console) and send email when SMTP is configured.
- **Profile edits for all three roles** (`PATCH /api/me/profile`) with an audit trail. A pharmacy that changes its
  name or address is flagged `needs_review` and the admin console shows a re-verification banner.
- **Admin oversight**: every order across pharmacies, an account directory with suspend/re-enable, licence review,
  and the re-verification queue.
- Patient/pharmacy registration, one-time admin bootstrap, forgot-password OTP, nearby stores, default location,
  prescription files and consent/privacy export/delete.

## Not built yet
Live payments (Razorpay), automated rider dispatch/live courier positions, the patient medicine-cabinet API and the
SMS/email reminder scheduler. The parts of the pharmacy console that show refill quotes, batch stock and dispatch
still run on in-browser demo state (`client/src/pages/PharmacyPage.jsx`); the real order queue and the real price
list sit above them. The schema for the remaining tables already exists.

## Tests and operations
```bash
cd server
npm test          # unit tests + end-to-end API tests (needs the demo seed)
npm run test:unit # pure functions only, no database needed
```

`npm test` starts the real Express app on a random port and drives it with fetch: cookie sessions, catalogue-only
ordering, stock reservation/release, decline, cancel, file access (including the audit row), profile auditing,
admin scoping and sign-out. CI (`.github/workflows/ci.yml`) runs it against a Postgres service, then builds the client.

| Task | Command |
|---|---|
| Apply pending migrations | `npm run db:migrate` |
| Fresh local database + demo data | `npm run db:setup` |
| Daily health-data retention | runs in-process (`RETENTION_CRON`, default 03:00); manual: `npm run db:retention` |
| Database backup | `DATABASE_URL=… npm run db:backup` → `backups/medisync-*.dump.gz`, keeps 30 |
| API description | `GET /api/openapi.json` (import into Postman/Insomnia) |

Migrations live in `server/db/migrations` and are recorded in `schema_migrations`, so an existing deployment
upgrades in place (`001_baseline` is marked applied automatically). Prescription uploads are encrypted at rest with
AES-256-GCM; set `FILE_ENCRYPTION_KEY` (64 hex chars) to separate that key from `JWT_SECRET`. Opening a prescription
file writes a row to `prescription_file_access` (who opened which file, when). Retention deletes prescription files
for delivered/cancelled orders older than `PRESCRIPTION_RETENTION_DAYS` (default 180), old notifications, and expired
geo cache entries. Back up the upload disk on the same schedule as the database.

## Deploy a permanent site (Render)
`render.yaml` in this folder defines one Node web service (API + built React app), a managed PostgreSQL database and
1 GB persistent disk for prescription uploads. Apply it from **Render → New → Blueprint**, choose this repository and
set the Blueprint Path to `medisync/render.yaml`. Render prompts for the secrets it needs, then runs
`npm run build`, the schema migration and `npm start` on every deploy.

Both resources use the cheapest paid plans: free Postgres databases expire after 30 days and free web services cannot
attach a disk, so either would break a permanent link. The service gets `https://<name>.onrender.com`; add a custom
domain in Render when you have one (the API accepts its own origin automatically, so no origin list to edit).

Environment variables set by the Blueprint: `NODE_ENV=production`, `SERVE_CLIENT=true`, `DATABASE_URL` (linked to the
managed database), `DATABASE_SSL=false` (internal URL), generated `JWT_SECRET`, `UPLOAD_DIR=/var/data/uploads`,
`AUTO_VERIFY_PHARMACIES=false`, `DEV_LOG_OTP=false`, `SESSION_COOKIE_DAYS=7`, `RETENTION_CRON=0 3 * * *`,
`PRESCRIPTION_RETENTION_DAYS=180`. Browser sessions are httpOnly cookies, so no token is stored in localStorage;
same-origin API calls work behind Render's proxy without listing the deployment URL, and cross-site writes carrying
the cookie are rejected. The retention sweep runs inside the web process because a Render Cron Job cannot mount the
prescription disk — run `npm run db:retention` from a Render shell if you ever disable `RETENTION_CRON`.

Add these in Render → Service → Environment when you want the related features:

| Variable | Purpose |
|---|---|
| `GOOGLE_MAPS_SERVER_KEY` | Live Places/Geocoding results for nearby shops (restrict by IP) |
| `GOOGLE_MAPS_BROWSER_KEY` | Real Google map tiles (restrict by HTTP referrer) |
| `GEOCODER_NOMINATIM` (default `true`), `GEOCODER_USER_AGENT` | Keyless fallback for typed place names: the built-in locality index first, then OpenStreetMap Nominatim (one request/second). Set a Google key and/or your own geocoder for real traffic |
| `SMS_PROVIDER`, `FAST2SMS_API_KEY` or `TWILIO_*` | Real OTPs and reminders by SMS (default is `console`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | OTP and reminder email |
| `CLIENT_ORIGIN` | Only needed if you host the SPA on a different origin from the API |

The first admin is created at `/` → **Create admin account** (the one-time bootstrap). Afterwards new admins come from
`npm run admin:create` in a Render shell. Prescription files live on the mounted disk, so they survive deploys;
snapshot or export that disk together with the database backups.

## Before real users
1. **Privacy policy:** `server/content/privacy-policy.md` is a plain-language draft with `[BRACKETED]` placeholders
   (company, address, grievance officer, providers, retention). Fill them in and have a lawyer review it.
2. **Licence checks:** keep `AUTO_VERIFY_PHARMACIES=false` and check each licence against the state drug controller's
   records before approving.
3. **SMS to Indian numbers:** needs DLT registration (entity, sender ID, templates) with your SMS provider.
4. **Schedule H:** the pharmacist-approval flow is an app workflow; whether it satisfies dispensing and online-pharmacy
   rules is a legal question to confirm with a lawyer.
5. **Google Maps keys:** restrict the server key by IP and the browser key by HTTP referrer; set a billing budget alert.
   Lookups go through `GOOGLE_MAPS_SERVER_KEY`; `GOOGLE_MAPS_BROWSER_KEY` is optional and only draws the map.
   With no Google key, place names still resolve through the built-in locality index (Bengaluru neighbourhoods and
   metro centres, typo-tolerant) and then the public OpenStreetMap Nominatim service — fine for a demo, but point
   `GEOCODER_NOMINATIM` at your own geocoder or set the Google key before real traffic.
6. **CORS:** same-origin requests (the SPA calling its own API, including on a custom domain) are always allowed.
   `ALLOW_PREVIEW_ORIGINS=true` (default outside production) additionally accepts any `*.style.dev` preview host and
   loopback port. Keep it `false` in production and list extra frontend origins in `CLIENT_ORIGIN`.
7. **Backups:** schedule `npm run db:backup` and copy `UPLOAD_DIR` on the same cadence; a database dump alone does
   not restore prescription files. Test a restore before you need one.
8. **Sessions and abuse:** sign-in and OTP endpoints are rate-limited per IP and per identifier, OTPs are capped per
   account per hour, and sessions live in httpOnly SameSite=Lax cookies with a CSRF origin check on writes. Rotating
   `JWT_SECRET` signs every session out.
