import cron from 'node-cron';
import { query } from '../config/db.js';
import { notifyUser } from '../services/notificationService.js';
import { sendEmail, sendSms } from '../utils/notify.js';

export async function ensureScheduleTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS reminder_schedules (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      med_name TEXT NOT NULL,
      dosage TEXT DEFAULT '',
      instructions TEXT DEFAULT '',
      dose_time VARCHAR(5) NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      last_sent_date DATE,
      escalated_date DATE
    )
  `);
  await query(`ALTER TABLE reminder_schedules ADD COLUMN IF NOT EXISTS escalated_date DATE`);

  await query(`
    CREATE TABLE IF NOT EXISTS patient_care_settings (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      caregiver_name TEXT DEFAULT '',
      caregiver_phone TEXT DEFAULT '',
      caregiver_email TEXT DEFAULT '',
      preferred_lang VARCHAR(5) NOT NULL DEFAULT 'kn',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

function getIstOffsetClock(offsetMinutes) {
  const target = new Date(Date.now() + offsetMinutes * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(target);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    todayIst: `${map.year}-${map.month}-${map.day}`,
    hhmm: `${map.hour}:${map.minute}`,
  };
}

function translateDosageKannadaScript(dosage) {
  const d = String(dosage || '').toLowerCase();
  if (d.includes('before')) return 'ಊಟಕ್ಕೆ ಮುಂಚೆ ಒಂದು ಮಾತ್ರೆ ತೆಗೆದುಕೊಳ್ಳಿ';
  if (d.includes('night') || d.includes('bedtime')) return 'ರಾತ್ರಿ ಊಟದ ನಂತರ ಒಂದು ಮಾತ್ರೆ ತೆಗೆದುಕೊಳ್ಳಿ';
  return 'ಊಟದ ನಂತರ ಒಂದು ಮಾತ್ರೆ ತೆಗೆದುಕೊಳ್ಳಿ';
}

function translateDosageKanglish(dosage) {
  const d = String(dosage || '').toLowerCase();
  if (d.includes('before')) return 'Ootakke munche ondu matre tegedukolli';
  if (d.includes('night') || d.includes('bedtime')) return 'Ratri ootada nantara ondu matre tegedukolli';
  return 'Ootada nantara ondu matre tegedukolli';
}

function formatLocalizedReminder(item, lang) {
  const doseInfo = `${item.med_name}${item.dosage ? ` (${item.dosage})` : ''}`;
  if (lang === 'kn') {
    const knScript = translateDosageKannadaScript(item.instructions || item.dosage);
    const kanglish = translateDosageKanglish(item.instructions || item.dosage);
    return {
      title: `MediSync Reminder: ${item.med_name} (${item.dose_time})`,
      body: `Samaya ${item.dose_time}: ${item.med_name} ${item.dosage || ''} matre. ${kanglish}.`,
      emailSubject: `MediSync ಜ್ಞಾಪನೆ: ${item.med_name} (5 ನಿಮಿಷಗಳಲ್ಲಿ)`,
      emailBody: `ಸಮಯ ${item.dose_time}.\n${item.med_name} ${item.dosage || ''} ಮಾತ್ರೆ.\n${knScript}.\n\n(${kanglish})`,
    };
  }
  if (lang === 'hi') {
    return {
      title: `MediSync रिमाइंडर: ${item.med_name} (5 मिनट में)`,
      body: `कृपया ${item.dose_time} बजे ${doseInfo} दवा लें।${item.instructions ? ` ${item.instructions}` : ''}`,
    };
  }
  return {
    title: `MediSync Reminder: ${item.med_name} due in 5 mins`,
    body: `Take ${doseInfo} at ${item.dose_time}.${item.instructions ? ` ${item.instructions}` : ''}`,
  };
}

export function startReminderScheduler() {
  cron.schedule('* * * * *', async () => {
    try {
      const plus5 = getIstOffsetClock(5);
      const { rows: dueSoon } = await query(
        `UPDATE reminder_schedules r
            SET last_sent_date = $1::date
          WHERE r.active = true
            AND r.dose_time = $2
            AND (r.last_sent_date IS NULL OR r.last_sent_date < $1::date)
          RETURNING r.id, r.user_id, r.med_name, r.dosage, r.instructions, r.dose_time`,
        [plus5.todayIst, plus5.hhmm]
      );

      for (const item of dueSoon) {
        const prefRes = await query(
          `SELECT preferred_lang FROM patient_care_settings WHERE user_id = $1`,
          [item.user_id]
        );
        const lang = prefRes.rows[0]?.preferred_lang || 'kn';
        const localized = formatLocalizedReminder(item, lang);
        await notifyUser({
          userId: item.user_id,
          type: 'medication_reminder',
          title: localized.title,
          body: localized.body,
          emailSubject: localized.emailSubject,
          emailBody: localized.emailBody,
        });
        console.log(`[scheduler] Sent 5-min (${lang}) reminder for ${item.med_name} (${item.dose_time})`);
      }

      const minus30 = getIstOffsetClock(-30);
      const { rows: missed } = await query(
        `UPDATE reminder_schedules r
            SET escalated_date = $1::date
          WHERE r.active = true
            AND r.dose_time = $2
            AND (r.escalated_date IS NULL OR r.escalated_date < $1::date)
          RETURNING r.id, r.user_id, r.med_name, r.dosage, r.dose_time`,
        [minus30.todayIst, minus30.hhmm]
      );

      for (const item of missed) {
        const careRes = await query(
          `SELECT c.caregiver_name, c.caregiver_phone, c.caregiver_email, COALESCE(p.name, u.email) AS patient_name
             FROM patient_care_settings c
             JOIN users u ON u.id = c.user_id
             LEFT JOIN patients p ON p.user_id = c.user_id
            WHERE c.user_id = $1`,
          [item.user_id]
        );
        const care = careRes.rows[0];
        if (!care || (!care.caregiver_phone && !care.caregiver_email)) continue;

        const alertMsg = `MediSync Caregiver Alert: ${care.patient_name} has not marked their ${item.dose_time} dose of ${item.med_name}${item.dosage ? ` (${item.dosage})` : ''} as taken (30 mins overdue).`;

        if (care.caregiver_email) {
          sendEmail({
            to: care.caregiver_email,
            subject: `MediSync Missed-Dose Alert · ${care.patient_name}`,
            text: alertMsg,
          }).catch((e) => console.error('[caregiver] email failed:', e.message));
        }
        if (care.caregiver_phone) {
          const digits10 = String(care.caregiver_phone).replace(/\D/g, '').slice(-10);
          if (digits10.length === 10) {
            sendSms({ to: digits10, message: alertMsg }).catch((e) =>
              console.error('[caregiver] sms failed:', e.message)
            );
          }
        }
        console.log(`[scheduler] Escalated overdue dose (${item.med_name}) to caregiver ${care.caregiver_name || care.caregiver_phone}`);
      }
    } catch (err) {
      console.error('[scheduler] cron check failed:', err.message);
    }
  });

  console.log('[scheduler] 5-min Multilingual Reminder + 30-min Caregiver Escalation cron active');
}