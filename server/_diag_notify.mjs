import { query } from './src/config/db.js';
import { notifyUser } from './src/services/notificationService.js';

const { rows: users } = await query(
  "SELECT id, email, phone, role FROM users WHERE role = 'patient' ORDER BY created_at DESC LIMIT 3"
);
console.log('Patient users in DB:', users);

const { rows: recent } = await query(
  "SELECT id, user_id, type, title, created_at FROM notifications ORDER BY created_at DESC LIMIT 5"
);
console.log('Latest 5 DB notifications:', recent);

if (users[0]) {
  console.log('Firing direct notifyUser test for:', users[0].email, users[0].phone);
  const notifId = await notifyUser({
    userId: users[0].id,
    type: 'medication_reminder',
    title: 'MediSync Reminder: Direct Test',
    body: 'Samaya 22:15: Ootada nantara ondu matre tegedukolli.',
    emailSubject: 'MediSync ಜ್ಞಾಪನೆ: Direct Test',
    emailBody: 'ಸಮಯ 22:15. ಊಟದ ನಂತರ ಒಂದು ಮಾತ್ರೆ ತೆಗೆದುಕೊಳ್ಳಿ.',
  });
  console.log('Inserted notification ID:', notifId);
  await new Promise((r) => setTimeout(r, 4000));
}
process.exit(0);