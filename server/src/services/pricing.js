// Pure order pricing. The server is the only source of truth: the browser sends catalogue
// ids and quantities, never prices. Keeping this separate makes it unit-testable.

export const round2 = (value) => Number(Number(value).toFixed(2));

// lines: [{ mrp, discountPct, quantity }]
export function quoteOrder(lines) {
  const totalMrp = lines.reduce((sum, line) => sum + Number(line.mrp) * line.quantity, 0);
  const finalPrice = lines.reduce(
    (sum, line) => sum + Number(line.mrp) * (1 - Number(line.discountPct ?? 0) / 100) * line.quantity,
    0
  );
  const discountPct = totalMrp > 0 ? round2((1 - finalPrice / totalMrp) * 100) : 0;
  return { totalMrp: round2(totalMrp), finalPrice: round2(finalPrice), discountPct };
}

export const lineTotal = (line) =>
  round2(Number(line.mrp) * (1 - Number(line.discountPct ?? 0) / 100) * line.quantity);
