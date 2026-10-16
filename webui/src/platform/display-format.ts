/** Compact nonnegative counts, preserving locale formatting below 1000. */
export function formatCompactCount(n: unknown): string {
  const value = Number(n);
  if (!value || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return value.toLocaleString();
}

/** Round milliseconds to the nearest second and display m:ss; blank when unknown. */
export function formatRoundedDurationMs(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
