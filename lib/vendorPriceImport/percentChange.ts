export function computePercentChange(costBefore: number, costAfter: number): number | null {
  if (!Number.isFinite(costBefore) || !Number.isFinite(costAfter)) return null;
  if (costBefore === 0) return null;
  const pct = ((costAfter - costBefore) / costBefore) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct * 100) / 100;
}

export function formatPercentChange(pct: number | null): string {
  if (pct === null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}
