import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!env.smtp.host) return null;
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
  return transporter;
}

export async function sendEmail({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) {
    console.warn(`[email] SMTP not configured - skipped email to ${to}: "${subject}"`);
    return { skipped: true };
  }
  const info = await t.sendMail({ from: env.smtp.from, to, subject, text, html: html ?? undefined });
  console.log(`[notify:email] Sent to ${to} (messageId=${info.messageId})`);
  return { sent: true, messageId: info.messageId };
}

function formatSmsPayload(text) {
  const cleaned = String(text || '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const hasUnicode = /[^\x00-\x7F]/.test(cleaned);
  return cleaned.slice(0, hasUnicode ? 140 : 155);
}

export async function sendSms({ to, message, otp }) {
  const provider = (process.env.SMS_PROVIDER || env.sms?.provider || '').trim().toLowerCase();
  const countryCode = (process.env.DEFAULT_COUNTRY_CODE || env.sms?.countryCode || '+91').trim();
  const cleanMsg = formatSmsPayload(message);

  switch (provider) {
    case 'gateway': {
      const url = (process.env.SMS_GATEWAY_URL || '').trim();
      const token = (process.env.SMS_GATEWAY_TOKEN || '').trim();
      if (!url || !token) throw new Error('SMS_GATEWAY_URL or SMS_GATEWAY_TOKEN is not set');

      const recipient = `${countryCode}${to}`;
      console.log(`[notify:sms-gateway] POST ${url} -> to=${recipient} (${cleanMsg.length} chars)`);

      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ to: recipient, message: cleanMsg }),
      });

      const responseText = await res.text().catch(() => '');
      console.log(`[notify:sms-gateway] response status=${res.status} body=${JSON.stringify(responseText)}`);

      if (!res.ok) {
        throw new Error(`Phone SMS Gateway error (${res.status}): ${responseText || res.statusText}`);
      }
      return { sent: true, status: res.status, body: responseText };
    }
    case 'twilio': {
      const { sid, token, from } = env.sms.twilio;
      if (!sid || !token || !from) throw new Error('Twilio credentials are not fully set');
      const twilio = (await import('twilio')).default;
      const client = twilio(sid, token);
      await client.messages.create({ to: `${countryCode}${to}`, from, body: cleanMsg });
      return { sent: true };
    }
    case 'fast2sms': {
      if (!env.sms.fast2smsKey) throw new Error('FAST2SMS_API_KEY is not set');
      const body = otp
        ? { route: 'otp', variables_values: String(otp), numbers: to }
        : { route: 'q', message: cleanMsg, language: 'english', numbers: to };
      const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: { authorization: env.sms.fast2smsKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.return === false) {
        throw new Error(`Fast2SMS error: ${data.message ?? res.statusText}`);
      }
      return { sent: true };
    }
    default:
      console.log(`[sms:console] (provider="${provider}") to ${to}: ${cleanMsg}`);
      return { skipped: true };
  }
}