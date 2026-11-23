import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFileType } from '../../src/utils/fileType.js';
import { decryptBuffer, encryptBuffer, encryptionEnabled } from '../../src/services/fileCrypto.js';
import { orderItemsSchema, profileUpdateSchema } from '../../src/validators/app.validators.js';

test('detectFileType trusts bytes, not the declared mime type', () => {
  assert.equal(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0x00]))?.mime, 'image/jpeg');
  assert.equal(
    detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime,
    'image/png'
  );
  assert.equal(detectFileType(Buffer.from('%PDF-1.7'))?.mime, 'application/pdf');
  assert.equal(detectFileType(Buffer.from('<html>not a prescription</html>')), null);
  assert.equal(detectFileType(Buffer.alloc(0)), null);
});

test('file encryption round-trips when a key is configured, and is a no-op without one', () => {
  const original = Buffer.from('prescription bytes');
  const stored = encryptBuffer(original);
  if (encryptionEnabled()) {
    assert.notDeepEqual(stored, original);
    assert.deepEqual(decryptBuffer(stored), original);
  } else {
    assert.deepEqual(stored, original);
  }
});

test('an order line carries no client-supplied price', () => {
  const parsed = orderItemsSchema.safeParse([
    { inventoryId: '6f1c1f1e-3f0e-4a1e-9c3a-1f2d3e4a5b6c', quantity: 2, mrp: 1 },
  ]);
  // Unknown keys are stripped, so `mrp` can never reach the pricing path.
  assert.equal(parsed.success, true);
  assert.equal(parsed.data[0].mrp, undefined);
  assert.equal(orderItemsSchema.safeParse([]).success, false);
  assert.equal(orderItemsSchema.safeParse([{ medicineName: 'Dolo 650', mrp: 45 }]).success, false);
});

test('profile validation rejects an empty patch and a bad mobile number', () => {
  assert.equal(profileUpdateSchema.safeParse({}).success, false);
  assert.equal(profileUpdateSchema.safeParse({ phone: '12345' }).success, false);
  assert.equal(profileUpdateSchema.safeParse({ name: 'Ananya Sharma' }).success, true);
});
