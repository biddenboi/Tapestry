import { HOUR, STORES } from '../Constants.js';
import { getTaskDuration } from './Tasks.js';
import { buildBehaviorProfile, defaultProfile } from './BehaviorProfile.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashString(value = '') {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

const GHOST_ACTIVITIES = [
  'doing calculus', 'debugging code', 'reading research', 'writing an essay',
  'reviewing lecture notes', 'solving equations', 'practicing algorithms',
  'studying biology', 'writing documentation', 'working on a project',
  'grinding problem sets', 'learning German', 'reading a textbook', 'doing physics',
  'coding a new feature', 'studying history', 'writing a report', 'prepping for exam',
  'practicing piano', 'doing chemistry labs', 'reading philosophy', 'language drills',
  'working through proofs', 'studying anatomy', 'drafting architecture designs',
  'working on linear algebra', 'reading case studies', 'memorizing flashcards',
];

/** Returns a deterministic activity/task-name for a ghost player at a given point in time */
export function getGhostActivity(ghost, elapsedRatio = 0) {
  const windowIndex = Math.floor(clamp(elapsedRatio, 0, 0.999) * 10);
  const seed = hashString(`${ghost.UUID}-act-${windowIndex}`);
  // Use real task names from their history if available
  if (ghost.recentTaskNames && ghost.recentTaskNames.length > 0) {
    return ghost.recentTaskNames[seed % ghost.recentTaskNames.length];
  }
  // Fallback for synthetic ghosts: generic study activities
  return GHOST_ACTIVITIES[seed % GHOST_ACTIVITIES.length];
}

async function estimateGhostPower(databaseConnection, player, durationHours) {
  const tasks = await databaseConnection.getPlayerStore(STORES.task, player.UUID);
  const completed = tasks
    .filter((task) => task.completedAt && task.createdAt)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
    .slice(0, 24);

  const totalDuration = completed.reduce((sum, task) => sum + getTaskDuration(task), 0);
  const totalPoints = completed.reduce((sum, task) => sum + Number(task.points || 0), 0);

  // Fallback rate for ghosts with no task history: scales with ELO, floored so
  // even brand-new accounts produce ghosts with enough budget to play the map.
  // Baseline is ~120 pts/hr (equivalent to 20 min of focused work per hour).
  const fallbackPerMs = Math.max(120 / HOUR, ((player.elo || 900) / 1000) * 200 / HOUR);
  const pointsPerMs = totalDuration > 0
    ? totalPoints / totalDuration
    : fallbackPerMs;

  const expectedTotal = Math.round(pointsPerMs * durationHours * HOUR);
  const floor = Math.round(durationHours * 120);

  const matches = await databaseConnection.getPlayerStore(STORES.match, player.UUID).catch(() => []);
  const behaviorProfile = buildBehaviorProfile(completed, matches, player);

  return {
    ...player,
    pointsPerMs,
    estimatedTotal: Math.max(floor, expectedTotal),
    isGenerated: false,
    recentTaskNames: completed.filter((t) => t.name).map((t) => t.name).slice(0, 15),
    playerTheme: player.activeCosmetics?.theme || 'default',
    cardBanner: player.activeCosmetics?.cardBanner || null,
    behaviorProfile,
  };
}

function synthGhost(currentPlayer, durationHours, index) {
  const seed = hashString(`${currentPlayer.UUID}-${currentPlayer.createdAt || ''}-${index}`);
  const variance = 0.82 + seededRandom(seed) * 0.38;
  const baseElo = (currentPlayer.elo || 1000) || 1000;   // coerce 0 ELO users toward a sane ghost range
  const elo = Math.max(100, Math.round(baseElo + (seededRandom(seed + 1) - 0.5) * 180));
  const floor = Math.round(durationHours * 120);
  const estimatedTotal = Math.max(
    floor,
    Math.round((Math.max(baseElo, 400) / 8) * durationHours * variance),
  );
  return {
    UUID: `ghost-${currentPlayer.UUID}-${index}`,
    username: `${currentPlayer.username || 'Agent'} Echo ${index + 1}`,
    profilePicture: null,
    elo,
    estimatedTotal,
    pointsPerMs: estimatedTotal / (durationHours * HOUR),
    isGenerated: true,
    generatedSeed: seed,
    behaviorProfile: defaultProfile({ elo }),
  };
}

function chooseBalancedTeams(currentPlayer, ghosts) {
  let best = null;
  const scoredGhosts = ghosts.map((ghost) => ({
    ...ghost,
    matchPower: (ghost.elo || 1000) + (ghost.estimatedTotal || 0) * 0.55,
  }));

  for (let i = 0; i < scoredGhosts.length; i += 1) {
    for (let j = i + 1; j < scoredGhosts.length; j += 1) {
      const team1 = [scoredGhosts[i], scoredGhosts[j]];
      const team2 = scoredGhosts.filter((_, idx) => idx !== i && idx !== j);
      if (team2.length !== 3) continue;

      const team1Power = team1.reduce((sum, ghost) => sum + ghost.matchPower, (currentPlayer.elo || 1000) + 220);
      const team2Power = team2.reduce((sum, ghost) => sum + ghost.matchPower, 0);
      const diff = Math.abs(team1Power - team2Power);

      if (!best || diff < best.diff) {
        best = { team1, team2, diff };
      }
    }
  }

  return best || { team1: scoredGhosts.slice(0, 2), team2: scoredGhosts.slice(2, 5), diff: Infinity };
}

export async function buildGhostRoster(databaseConnection, allPlayers, currentPlayer, durationHours) {
  const candidates = allPlayers.filter((player) => player.UUID !== currentPlayer.UUID);
  const rated = await Promise.all(candidates.map((player) => estimateGhostPower(databaseConnection, player, durationHours)));

  rated.sort((a, b) => {
    const eloDistanceA = Math.abs((a.elo || 1000) - (currentPlayer.elo || 1000));
    const eloDistanceB = Math.abs((b.elo || 1000) - (currentPlayer.elo || 1000));
    if (eloDistanceA !== eloDistanceB) return eloDistanceA - eloDistanceB;
    return (b.estimatedTotal || 0) - (a.estimatedTotal || 0);
  });

  const selected = rated.slice(0, 5);
  while (selected.length < 5) {
    selected.push(synthGhost(currentPlayer, durationHours, selected.length));
  }

  const { team1, team2, diff } = chooseBalancedTeams(currentPlayer, selected);
  return {
    teammates: team1,
    opponents: team2,
    diagnostics: {
      poolSize: candidates.length,
      selectedSize: selected.length,
      balanceDelta: Math.round(diff),
      synthesizedGhosts: selected.filter((ghost) => ghost.isGenerated).length,
    },
  };
}

export function getGhostScore(player, createdAt, durationHours) {
  const matchStart = new Date(createdAt).getTime();
  const elapsedRatio = clamp((Date.now() - matchStart) / (durationHours * HOUR), 0, 1);
  const seed = hashString(`${player.UUID}-${createdAt}`);
  const base = Number(player.estimatedTotal || 0);
  const progress = Math.pow(elapsedRatio, 0.92 + seededRandom(seed) * 0.18);
  const volatility = (seededRandom(seed + Math.floor(elapsedRatio * 12)) - 0.5) * 0.08;
  const scaled = base * clamp(progress + volatility, 0, 1.05);
  return Math.max(0, Math.round(scaled));
}

/**
 * Computes per-player ELO deltas based on team tower HP totals as scores.
 * Returns { [UUID]: deltaELO }.
 */
export function computeEloChanges(match, scoreMap, currentPlayerUUID) {
  const K = 24; // standard ELO K-factor
  const [team1, team2] = match.teams || [[], []];
  const team1Score = team1.reduce((s, p) => s + (scoreMap[p.UUID] || 0), 0) / Math.max(1, team1.length);
  const team2Score = team2.reduce((s, p) => s + (scoreMap[p.UUID] || 0), 0) / Math.max(1, team2.length);

  const deltas = {};
  const allP = [...team1, ...team2];

  for (const player of allP) {
    const isTeam1 = team1.some((p) => p.UUID === player.UUID);
    const myScore = isTeam1 ? team1Score : team2Score;
    const opScore = isTeam1 ? team2Score : team1Score;

    // ELO expected win probability
    const eloA  = player.elo || 900;
    const avgOp = (isTeam1 ? team2 : team1).reduce((s, p) => s + (p.elo || 900), 0) / Math.max(1, (isTeam1 ? team2 : team1).length);
    const expected = 1 / (1 + Math.pow(10, (avgOp - eloA) / 400));
    const actual   = myScore > opScore ? 1 : myScore < opScore ? 0 : 0.5;
    deltas[player.UUID] = Math.round(K * (actual - expected));
  }

  return deltas;
}
