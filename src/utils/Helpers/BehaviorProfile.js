import { HOUR } from '../Constants.js';
import { getTaskDuration } from './Tasks.js';

/**
 * Builds a behavior profile from a player's historical data.
 * All weights are in [0, 1] and drive the ghost AI decision-making.
 */
export function buildBehaviorProfile(tasks = [], matches = [], player = {}) {
  const done = tasks.filter((t) => t.completedAt && Number(t.points) > 0);
  if (done.length < 3) return defaultProfile(player);

  const pts = done.map((t) => Number(t.points));
  const totalPts = pts.reduce((s, p) => s + p, 0);
  const totalHrs = done.reduce((s, t) => s + getTaskDuration(t), 0) / HOUR;

  // pace: normalized pts/hr (150 pts/hr → 1.0)
  const ptsPerHr = totalHrs > 0 ? totalPts / totalHrs : 0;
  const pace = Math.min(1, Math.max(0, ptsPerHr / 150));

  // burst: coefficient of variation of task point values
  const mean = totalPts / pts.length;
  const variance = pts.reduce((s, p) => s + (p - mean) ** 2, 0) / pts.length;
  const burst = Math.min(1, mean > 0 ? Math.sqrt(variance) / mean : 0.4);

  // aggression: elo-based proxy — higher elo correlates with competitive drive
  const elo = player.elo || 900;
  const aggression = Math.min(1, Math.max(0, 0.25 + (elo - 700) / 1400));

  // expansion: avg task duration proxy — longer tasks → more patient/systematic player
  const avgMinutes = done.reduce((s, t) => s + getTaskDuration(t), 0) / (done.length * 60_000);
  const expansion = Math.min(1, Math.max(0, 0.25 + Math.min(0.6, (avgMinutes - 15) / 60)));

  // defense: low win rate → more defensive; also inverse of aggression
  const played = matches.filter((m) => m.result).length;
  const won = matches.filter((m) => m.result?.iWon).length;
  const winRate = played > 2 ? won / played : 0.5;
  const defense = Math.min(1, Math.max(0, (1 - aggression) * 0.6 + (1 - winRate) * 0.4));

  return { pace, burst, aggression, expansion, defense };
}

export function defaultProfile(player = {}) {
  const elo = player.elo || 900;
  const norm = Math.min(1, Math.max(0, (elo - 500) / 1500));
  return {
    pace:       0.25 + norm * 0.5,
    burst:      0.4,
    aggression: 0.25 + norm * 0.45,
    expansion:  0.45,
    defense:    0.4,
  };
}
