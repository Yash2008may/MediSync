import { query } from './src/config/db.js';
import { sendEmail, sendSms } from './src/utils/notify.js';

const { rows } = await query("SELECT email, phone FROM users WHERE role = 'patient' ORDER BY created_at DESC LIMIT 1");
const u = rows[0];
console.log('Sending test to:', u);

if (u?.email) {
  await sendEmail({
    to: u.email,
    subject: 'MediSync ಜ್ಞಾಪನೆ: Vitamin D3',
    text: 'ಸಮಯ 22:00.\nVitamin D3 ಮಾತ್ರೆ.\nಊಟದ ನಂತರ ಒಂದು ಮಾತ್ರೆ ತೆಗೆದುಕೊಳ್ಳಿ.\n\n(Samaya 22:00: Ootada nantara ondu matre tegedukolli.)',
  });
}
if (u?.phone) {
  const digits = String(u.phone).replace(/\D/g, '').slice(-10);
  await sendSms({
    to: digits,
    message: 'MediSync Reminder: Samaya 22:00 - Vitamin D3 matre. Ootada nantara ondu matre tegedukolli.',
  });
}
process.exit(0);