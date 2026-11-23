import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { detectFileType } from '../utils/fileType.js';
import { decryptBuffer, encryptBuffer, encryptionEnabled } from './fileCrypto.js';
import { prescriptionDir } from './accountService.js';

// Writes a checked prescription upload (magic bytes, not the client's mime type)
// to the prescription store. Returns null when the bytes are not JPG/PNG/PDF.
// With FILE_ENCRYPTION_KEY set the bytes are sealed with AES-256-GCM and the file name
// gains an `.enc` suffix, so the disk alone never reveals a prescription.
export async function storePrescriptionFile(file) {
  const type = detectFileType(file.buffer);
  if (!type) return null;

  const storedName = `${crypto.randomUUID()}.${type.ext}${encryptionEnabled() ? '.enc' : ''}`;
  await fs.mkdir(prescriptionDir(), { recursive: true });
  await fs.writeFile(path.join(prescriptionDir(), storedName), encryptBuffer(file.buffer), { mode: 0o600 });
  return { storedName, mimeType: type.mime, encrypted: encryptionEnabled() };
}

// Reads a stored prescription back into memory (decrypting when needed), so the API never
// has to expose a filesystem path or a long-lived link.
export async function readPrescriptionFile(storedName) {
  const buffer = await fs.readFile(path.join(prescriptionDir(), storedName));
  return storedName.endsWith('.enc') ? decryptBuffer(buffer) : buffer;
}

export { prescriptionDir };
