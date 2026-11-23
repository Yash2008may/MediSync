import test from 'node:test';
import assert from 'node:assert/strict';
import { lineTotal, quoteOrder, round2 } from '../../src/services/pricing.js';

test('quoteOrder sums MRP and applies each line discount', () => {
  const totals = quoteOrder([
    { mrp: 100, discountPct: 10, quantity: 2 },
    { mrp: 50, discountPct: 0, quantity: 1 },
  ]);
  assert.deepEqual(totals, { totalMrp: 250, finalPrice: 230, discountPct: 8 });
});

test('quoteOrder handles a zero-value basket without dividing by zero', () => {
  assert.deepEqual(quoteOrder([{ mrp: 0, discountPct: 0, quantity: 1 }]), {
    totalMrp: 0,
    finalPrice: 0,
    discountPct: 0,
  });
});

test('lineTotal rounds to paise', () => {
  assert.equal(lineTotal({ mrp: 99.99, discountPct: 12.5, quantity: 3 }), 262.47);
  assert.equal(round2(1.006), 1.01);
});
