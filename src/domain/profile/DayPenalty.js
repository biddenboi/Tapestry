import { getIgtDayNumber } from '@domain/events/Events.js';

const STRIKE_THRESHOLD_PMF = Object.freeze([
  [1, 0.04], [2, 0.07], [3, 0.10], [4, 0.14],
  [5, 0.20], [6, 0.22], [7, 0.15], [8, 0.08],
]);

export function sampleDayPenaltyThreshold(random = Math.random) {
  const value = random();
  let cumulative = 0;
  for (const [threshold, probability] of STRIKE_THRESHOLD_PMF) {
    cumulative += probability;
    if (value < cumulative) return threshold;
  }
  return STRIKE_THRESHOLD_PMF.at(-1)[0];
}

export function readDayPenalty(databaseConnection, player, { random = Math.random } = {}) {
  if (!databaseConnection || !player?.UUID) return null;
  const igtDay = getIgtDayNumber(player);
  let penalty = databaseConnection.getViolations(player.UUID, igtDay);
  if (!Number.isInteger(penalty.threshold) || penalty.threshold <= 0) {
    penalty = { ...penalty, igtDay, threshold: sampleDayPenaltyThreshold(random) };
    databaseConnection.setViolations(player.UUID, penalty);
  }
  return Object.freeze({ ...penalty, igtDay });
}

export function reportDayPenalty(databaseConnection, player, options = {}) {
  const current = readDayPenalty(databaseConnection, player, options);
  if (!current) throw new Error('A current profile is required to report a penalty.');
  const next = { ...current, strikes: Number(current.strikes || 0) + 1 };
  databaseConnection.setViolations(player.UUID, next);
  const limitReached = next.strikes >= next.threshold;
  if (limitReached) databaseConnection.setBanPending(player.UUID);
  return Object.freeze({ ...next, limitReached });
}

export default reportDayPenalty;
