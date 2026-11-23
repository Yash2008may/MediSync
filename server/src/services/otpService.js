import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { sendEmail, sendSms } from '../utils/notify.js';

export const generateOtp = () => String(crypto.randomInt(100000, 1000000));

export const hashOtp = (userId, otp) =>
  crypto.createHmac('sha256', env.jwtSecret).update(`${userId}:${otp}`).digest('hex');

export function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Sends the OTP to BOTH registered email and mobile. Failures are logged, never thrown.
export async function sendOtpNotifications(user, otp) {
  const ttl = env.otp.ttlMinutes;
  const message = `Your MediSync OTP is ${otp}. Valid for ${ttl} minutes. Do not share it with anyone.`;

  const results = await Promise.allSettled([
    sendEmail({
      to: user.email,
      subject: 'MediSync password reset OTP',
      text: message,
      html: `<div style="font-family:Arial,sans-serif;max-width:420px">
        <h2 style="color:#0d9488">MediSync</h2>
        <p>Use this one-time code to reset your password:</p>
        <p style="font-size:32px;letter-spacing:8px;font-weight:bold">${otp}</p>
        <p style="color:#64748b">Valid for ${ttl} minutes. If you didn't request this, ignore this email.</p>
      </div>`,
    }),
    sendSms({ to: user.phone, message, otp }),
  ]);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[otp] ${i === 0 ? 'email' : 'sms'} delivery failed:`, r.reason?.message);
    }
  });
}
