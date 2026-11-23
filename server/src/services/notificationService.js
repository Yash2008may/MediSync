import { query } from '../config/db.js';
import { sendEmail, sendSms } from '../utils/notify.js';

// In-app notification (always stored) plus best-effort Email AND SMS to the user's
// registered email ID and 10-digit mobile number. Never throws so a gateway failure won't roll back orders.
export async function notifyUser({ userId, type, title, body, orderId = null, email = null, phone = null, emailSubject = null, emailBody = null }) {
  try {
    const { rows } = await query(
      `INSERT INTO notifications (user_id, type, title, body, order_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, type, title, body, orderId]
    );

    let targetEmail = email;
    let targetPhone = phone;

    // Fetch the patient/store user's registered email and phone from PostgreSQL if not passed
    if (userId && (!targetEmail || !targetPhone)) {
      const userRes = await query('SELECT email, phone FROM users WHERE id = $1', [userId]);
      const u = userRes.rows[0];
      if (u) {
        targetEmail = targetEmail || u.email;
        targetPhone = targetPhone || u.phone;
      }
    }

    if (targetEmail) {
      sendEmail({ to: targetEmail, subject: emailSubject || title, text: emailBody || body }).catch((error) =>
        console.error('[notify] email failed:', error.message)
      );
    }

    if (targetPhone) {
      const digits10 = String(targetPhone).replace(/\D/g, '').slice(-10);
      if (digits10.length === 10) {
        sendSms({ to: digits10, message: `${title}: ${body}` }).catch((error) =>
          console.error('[notify] sms failed:', error.message)
        );
      }
    }

    return rows[0]?.id ?? null;
  } catch (error) {
    console.error('[notify] could not store notification:', error.message);
    return null;
  }
}

export async function listNotifications(userId, limit = 30) {
  const { rows } = await query(
    `SELECT id, type, title, body, order_id AS "orderId", read_at AS "readAt", created_at AS "createdAt"
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  const unread = await query(
    'SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [userId]
  );
  return { notifications: rows, unread: unread.rows[0]?.count ?? 0 };
}