// Money helpers. Everything is integer cents.

export function dollarsToCents(input: string | number): number {
  const n = typeof input === "string" ? parseFloat(input) : input;
  if (!Number.isFinite(n) || n < 0) throw new Error("Invalid amount");
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

/** Split `total` cents into `n` shares that sum exactly to total (largest-remainder). */
export function splitCentsEvenly(total: number, n: number): number[] {
  if (n <= 0) throw new Error("Cannot split among zero people");
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  const out = new Array<number>(n).fill(base);
  for (let i = 0; i < remainder; i++) out[i] += 1;
  return out;
}

/**
 * Split `total` cents by weights (e.g. claimed subtotals). Shares sum exactly
 * to total via largest-remainder on the fractional parts.
 */
export function splitCentsByWeight(total: number, weights: number[]): number[] {
  if (weights.length === 0) throw new Error("Cannot split among zero people");
  const wSum = weights.reduce((a, b) => a + b, 0);
  if (wSum <= 0) return splitCentsEvenly(total, weights.length);
  const raw = weights.map((w) => (total * w) / wSum);
  const floored = raw.map(Math.floor);
  let remainder = total - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floored];
  for (let k = 0; k < remainder; k++) out[order[k % order.length].i] += 1;
  return out;
}
