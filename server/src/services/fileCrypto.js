import crypto from 'node:crypto';
import { env } from '../config/env.js';

// Prescription images are health data, so they are sealed with AES-256-GCM before they reach
// the disk. A leaked backup or disk snapshot therefore does not expose prescriptions.
// Layout: 12-byte IV | 16-byte auth tag | ciphertext.
//
// The key is FILE_ENCRYPTION_KEY (64 hex chars) when set. Otherwise it is derived from
// JWT_SECRET, so encryption is on by default instead of silently storing plaintext.
// Setting FILE_ENCRYPTION_KEY later does not rewrite existing files — old files stay readable
// because the read path keys off the `.enc` suffix, not the current configuration.
const KEY = env.fileEncryptionKey
  ? Buffer.from(env.fileEncryptionKey, 'hex')
  : crypto.createHash('sha256').update(`medisync-prescription-files:${env.jwtSecret}`).digest();

export const encryptionEnabled = () => Boolean(KEY);

export function encryptBuffer(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBuffer(sealed) {
  if (sealed.length < 29) throw new Error('Encrypted file is truncated');
  const iv = sealed.subarray(0, 12);
  const tag = sealed.subarray(12, 28);
  const ciphertext = sealed.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
