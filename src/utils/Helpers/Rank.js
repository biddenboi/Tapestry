/* Valorant-style 25-tier rank system */

const TIERS = [
  { group: 'Iron',      sub: 'I',   minElo: 0,    maxElo: 74,   color: '#8892a0', glow: 'rgba(136,146,160,0.5)', icon: '◈' },
  { group: 'Iron',      sub: 'II',  minElo: 75,   maxElo: 149,  color: '#8892a0', glow: 'rgba(136,146,160,0.5)', icon: '◈' },
  { group: 'Iron',      sub: 'III', minElo: 150,  maxElo: 224,  color: '#8892a0', glow: 'rgba(136,146,160,0.5)', icon: '◈' },
  { group: 'Bronze',    sub: 'I',   minElo: 225,  maxElo: 299,  color: '#c87941', glow: 'rgba(200,121,65,0.55)', icon: '◉' },
  { group: 'Bronze',    sub: 'II',  minElo: 300,  maxElo: 374,  color: '#c87941', glow: 'rgba(200,121,65,0.55)', icon: '◉' },
  { group: 'Bronze',    sub: 'III', minElo: 375,  maxElo: 449,  color: '#c87941', glow: 'rgba(200,121,65,0.55)', icon: '◉' },
  { group: 'Silver',    sub: 'I',   minElo: 450,  maxElo: 524,  color: '#c0c8d8', glow: 'rgba(192,200,216,0.55)', icon: '◇' },
  { group: 'Silver',    sub: 'II',  minElo: 525,  maxElo: 599,  color: '#c0c8d8', glow: 'rgba(192,200,216,0.55)', icon: '◇' },
  { group: 'Silver',    sub: 'III', minElo: 600,  maxElo: 674,  color: '#c0c8d8', glow: 'rgba(192,200,216,0.55)', icon: '◇' },
  { group: 'Gold',      sub: 'I',   minElo: 675,  maxElo: 749,  color: '#d4a017', glow: 'rgba(212,160,23,0.6)',  icon: '◆' },
  { group: 'Gold',      sub: 'II',  minElo: 750,  maxElo: 824,  color: '#d4a017', glow: 'rgba(212,160,23,0.6)',  icon: '◆' },
  { group: 'Gold',      sub: 'III', minElo: 825,  maxElo: 899,  color: '#d4a017', glow: 'rgba(212,160,23,0.6)',  icon: '◆' },
  { group: 'Platinum',  sub: 'I',   minElo: 900,  maxElo: 999,  color: '#22d3ee', glow: 'rgba(34,211,238,0.55)', icon: '⬡' },
  { group: 'Platinum',  sub: 'II',  minElo: 1000, maxElo: 1099, color: '#22d3ee', glow: 'rgba(34,211,238,0.55)', icon: '⬡' },
  { group: 'Platinum',  sub: 'III', minElo: 1100, maxElo: 1199, color: '#22d3ee', glow: 'rgba(34,211,238,0.55)', icon: '⬡' },
  { group: 'Diamond',   sub: 'I',   minElo: 1200, maxElo: 1349, color: '#60a5fa', glow: 'rgba(96,165,250,0.6)',  icon: '◈' },
  { group: 'Diamond',   sub: 'II',  minElo: 1350, maxElo: 1499, color: '#60a5fa', glow: 'rgba(96,165,250,0.6)',  icon: '◈' },
  { group: 'Diamond',   sub: 'III', minElo: 1500, maxElo: 1649, color: '#60a5fa', glow: 'rgba(96,165,250,0.6)',  icon: '◈' },
  { group: 'Ascendant', sub: 'I',   minElo: 1650, maxElo: 1799, color: '#00d68f', glow: 'rgba(0,214,143,0.6)',   icon: '⬟' },
  { group: 'Ascendant', sub: 'II',  minElo: 1800, maxElo: 1999, color: '#00d68f', glow: 'rgba(0,214,143,0.6)',   icon: '⬟' },
  { group: 'Ascendant', sub: 'III', minElo: 2000, maxElo: 2199, color: '#00d68f', glow: 'rgba(0,214,143,0.6)',   icon: '⬟' },
  { group: 'Immortal',  sub: 'I',   minElo: 2200, maxElo: 2449, color: '#f43f5e', glow: 'rgba(244,63,94,0.6)',   icon: '⬥' },
  { group: 'Immortal',  sub: 'II',  minElo: 2450, maxElo: 2699, color: '#f43f5e', glow: 'rgba(244,63,94,0.6)',   icon: '⬥' },
  { group: 'Immortal',  sub: 'III', minElo: 2700, maxElo: 2999, color: '#f43f5e', glow: 'rgba(244,63,94,0.6)',   icon: '⬥' },
  { group: 'Radiant',   sub: '',    minElo: 3000, maxElo: Infinity, color: '#fde047', glow: 'rgba(253,224,71,0.7)', icon: '✦' },
];

export const RANKS = TIERS;

export function getRank(elo = 0) {
  const e = Math.max(0, Number(elo) || 0);
  return TIERS.find((r) => e >= r.minElo && e <= r.maxElo) || TIERS[0];
}

/** Short display label e.g. "PLAT II" */
export function getRankLabel(elo = 0) {
  const r = getRank(elo);
  return r.sub ? `${r.group.toUpperCase()} ${r.sub}` : r.group.toUpperCase();
}

/** Full label */
export function getRankFullLabel(elo = 0) {
  const r = getRank(elo);
  return r.sub ? `${r.group} ${r.sub}` : r.group;
}

/** Progress 0-100 within the current sub-rank band */
export function getRankProgress(elo = 0) {
  const e = Math.max(0, Number(elo) || 0);
  const r = getRank(e);
  if (r.maxElo === Infinity) return 100;
  const range = r.maxElo - r.minElo + 1;
  return Math.min(100, Math.floor(((e - r.minElo) / range) * 100));
}

/** CSS box-shadow for rank glow */
export function getRankGlow(elo = 0, size = 16) {
  const { glow } = getRank(elo);
  return `0 0 ${size}px ${glow}, 0 0 ${size * 2.2}px ${glow}`;
}

/** Rank group name for CSS class */
export function getRankClass(elo = 0) {
  return getRank(elo).group.toLowerCase();
}

/**
 * Returns the minimum elo of the current player's major rank group.
 * e.g. Gold II (elo 750) → 675 (Gold I floor).
 * Used to prevent dropping below a major rank boundary on a loss.
 */
export function getRankGroupFloor(elo = 0) {
  const { group } = getRank(elo);
  // TIERS is sorted ascending — the first entry for the group is the group's minimum
  return TIERS.find((t) => t.group === group)?.minElo ?? 0;
}
