import { getGoalTierProgress } from '@domain/goals/GoalTiers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const safeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const getGoalUUID = (goal) => String(goal?.UUID || '');
const getContributionGoalUUID = (entry) => String(entry?.goalUUID || entry?.projectId || '');
const getContributionTime = (entry) => {
  const time = new Date(entry?.createdAt || entry?.completedAt || entry?.updatedAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

function playerName(player, fallback = 'Deleted User') {
  return player?.username || player?.name || fallback;
}

function makePlayerFallback(uuid, rows = []) {
  const row = rows.find((entry) => String(entry?.parent) === String(uuid));
  return {
    UUID: uuid,
    username: row?.playerNameSnapshot || row?.profileNameSnapshot || 'Deleted User',
    profilePicture: null,
  };
}

function buildPlayerMap(players = []) {
  return new Map((players || []).map((player) => [String(player.UUID), player]));
}

export const isGoalArchivedForWorld = (goal) => (
  goal?.status === 'archived' || Boolean(goal?.archivedAt || goal?.completedAt)
);

export const getGoalTierProgressForWorld = getGoalTierProgress;

function buildGoalLeaderboardForWorld(contributions, players, currentPlayer) {
  const playersByUUID = buildPlayerMap(players);
  const totals = new Map();
  for (const contribution of contributions) {
    if (!contribution?.parent) continue;
    const playerUUID = String(contribution.parent);
    totals.set(playerUUID, safeNumber(totals.get(playerUUID)) + safeNumber(contribution.value));
  }
  if (currentPlayer?.UUID && !totals.has(String(currentPlayer.UUID))) {
    totals.set(String(currentPlayer.UUID), 0);
  }
  return [...totals.entries()]
    .map(([playerUUID, value]) => ({
      playerUUID,
      player: playersByUUID.get(playerUUID) || makePlayerFallback(playerUUID, contributions),
      value,
    }))
    .filter((entry) => entry.value > 0 || entry.playerUUID === String(currentPlayer?.UUID || ''))
    .sort((a, b) => b.value - a.value || playerName(a.player).localeCompare(playerName(b.player)));
}

function getRecentContributionCount(contributions, nowMs) {
  const since = nowMs - (7 * DAY_MS);
  return contributions.filter((entry) => getContributionTime(entry) >= since).length;
}

export function buildGoalArenaModel({
  goal,
  contributions = [],
  players = [],
  currentPlayer = null,
  nowMs = Date.now(),
} = {}) {
  const totalContribution = contributions.reduce((sum, entry) => sum + safeNumber(entry.value), 0);
  const currentPlayerContribution = currentPlayer?.UUID
    ? contributions
      .filter((entry) => String(entry.parent) === String(currentPlayer.UUID))
      .reduce((sum, entry) => sum + safeNumber(entry.value), 0)
    : 0;
  const leaderboard = buildGoalLeaderboardForWorld(contributions, players, currentPlayer);
  const selfIndex = leaderboard.findIndex((entry) => entry.playerUUID === String(currentPlayer?.UUID || ''));
  const currentPlayerRank = selfIndex >= 0 && leaderboard[selfIndex]?.value > 0 ? selfIndex + 1 : null;
  const nextEntry = selfIndex > 0 ? leaderboard[selfIndex - 1] : null;
  const gapToNext = nextEntry ? Math.max(1, nextEntry.value - currentPlayerContribution + 1) : null;
  const contributorCount = new Set(contributions.map((entry) => entry?.parent).filter(Boolean).map(String)).size;
  const recentContributionCount = getRecentContributionCount(contributions, nowMs);
  const lastContribution = [...contributions].sort((a, b) => getContributionTime(b) - getContributionTime(a))[0] || null;
  const lastContributor = lastContribution
    ? buildPlayerMap(players).get(String(lastContribution.parent)) || makePlayerFallback(lastContribution.parent, contributions)
    : null;
  const tierProgress = getGoalTierProgressForWorld(totalContribution);
  const archived = isGoalArchivedForWorld(goal);
  const recentPulseLabel = recentContributionCount
    ? `${recentContributionCount} contribution entr${recentContributionCount === 1 ? 'y' : 'ies'} this week`
    : lastContribution
      ? `Last contribution by ${playerName(lastContributor)}`
      : 'No contribution yet';

  return {
    id: getGoalUUID(goal),
    goal,
    name: goal?.name || 'Untitled goal',
    description: goal?.description || 'A shared goal supported by completed work.',
    status: archived ? 'archived' : 'active',
    archived,
    totalContribution,
    currentPlayerContribution,
    contributorCount,
    tierProgress,
    leaderboard,
    topContributors: leaderboard.filter((entry) => entry.value > 0).slice(0, 3),
    currentPlayerRank,
    gapToNext,
    recentContributionCount,
    recentPulseLabel,
    lastContribution,
    lastContributor,
  };
}

export function buildGoalArenasModel({
  goals = [],
  contributions = [],
  players = [],
  currentPlayer = null,
  nowMs = Date.now(),
} = {}) {
  const contributionsByGoal = new Map();
  for (const entry of contributions || []) {
    const goalUUID = getContributionGoalUUID(entry);
    if (!goalUUID) continue;
    const rows = contributionsByGoal.get(goalUUID) || [];
    rows.push(entry);
    contributionsByGoal.set(goalUUID, rows);
  }
  const arenas = (goals || []).map((goal) => buildGoalArenaModel({
    goal,
    contributions: contributionsByGoal.get(getGoalUUID(goal)) || [],
    players,
    currentPlayer,
    nowMs,
  }));
  const activeArenas = arenas
    .filter((arena) => !arena.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  const archivedArenas = arenas
    .filter((arena) => arena.archived)
    .sort((a, b) => String(b.goal?.archivedAt || b.goal?.completedAt || '').localeCompare(String(a.goal?.archivedAt || a.goal?.completedAt || '')));
  const totalContribution = arenas.reduce((sum, arena) => sum + arena.totalContribution, 0);
  const currentPlayerContribution = arenas.reduce((sum, arena) => sum + arena.currentPlayerContribution, 0);
  const allTop = new Map();
  for (const arena of arenas) {
    for (const entry of arena.leaderboard) {
      allTop.set(entry.playerUUID, {
        ...entry,
        value: safeNumber(allTop.get(entry.playerUUID)?.value) + safeNumber(entry.value),
      });
    }
  }
  const topContributor = [...allTop.values()]
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || playerName(a.player).localeCompare(playerName(b.player)))[0] || null;
  const recentPulseCount = arenas.reduce((sum, arena) => sum + arena.recentContributionCount, 0);

  return {
    arenas,
    activeArenas,
    archivedArenas,
    summary: {
      activeCount: activeArenas.length,
      archivedCount: archivedArenas.length,
      totalContribution,
      currentPlayerContribution,
      topContributor,
      recentPulseCount,
    },
  };
}
