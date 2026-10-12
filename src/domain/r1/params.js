// Lot crates/lot-r1/src/lib.rs:23-100. Model time is fractional local-day hours.
export const DAY = 24;
export const EPS = 1e-9;
export const DEFAULT_PARAMS = Object.freeze({
  s: 1, pace: 2 / 3, kA: 2, m0: 4, sd0: 1.5, w0: 3, halfLife: 14,
  horizonDays: 28, policy: 'r1', todayRule: 'conditional', emptyDays: 'skip',
  depRecheck: 0.5, shiftStart: true, habitPacing: true, habitExtraOnce: true,
});
// Rust lib.rs:249-292.
export const fdiv = (x) => Math.floor(x / DAY);
export const vmin = (xs) => Math.min(...xs);
export const argmin = (xs) => xs.reduce((best, x, i) => x < xs[best] ? i : best, 0);
export const unique = (xs) => [...new Set(xs)].sort((a, b) => a - b);
export const searchRight = (xs, x) => { let l = 0; let r = xs.length; while (l < r) { const m = (l + r) >>> 1; if (xs[m] <= x) l = m + 1; else r = m; } return l; };
export const cmp3 = (a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
export const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// erfc for Rust lib.rs:650; Chebyshev approximation, relative error < 1.2e-7.
export function erfc(x) {
  const z = Math.abs(x); const t = 1 / (1 + z / 2);
  const v = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? v : 2 - v;
}
