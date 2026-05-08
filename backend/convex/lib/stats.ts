// Monetary values are integer cents.
export interface PricingStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  mode: number[];
}

export function computePricingStats(amounts: number[]): PricingStats | null {
  if (amounts.length === 0) return null;

  const sorted = [...amounts].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0];
  const max = sorted[count - 1];
  const mean = Math.round(sorted.reduce((sum, v) => sum + v, 0) / count);

  let median: number;
  const mid = Math.floor(count / 2);
  if (count % 2 === 0) {
    median = Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  } else {
    median = sorted[mid];
  }

  const freq = new Map<number, number>();
  for (const v of sorted) {
    freq.set(v, (freq.get(v) ?? 0) + 1);
  }
  const maxFreq = Math.max(...freq.values());
  const mode = [...freq.entries()]
    .filter(([, f]) => f === maxFreq)
    .map(([v]) => v)
    .sort((a, b) => a - b);

  return {count, min, max, mean, median, mode};
}
