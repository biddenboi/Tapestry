import { v4 as uuid } from 'uuid';
import { CONTRIBUTION_PASS_REWARDS, STORES } from '@domain/constants.js';
import { buildActionReward } from '@domain/rewards/RewardSchedule.js';

import {
  GOAL_TIERS,
  getGoalTier,
  getGoalTierProgress,
  getUnlockedGoalTierPerks,
} from '@domain/goals/GoalTiers.js';

export { GOAL_TIERS, getGoalTier, getGoalTierProgress, getUnlockedGoalTierPerks };

export function getContributionTotal(contributions = [], playerUUID = null) {
  return (contributions || []).reduce((total, contribution) => {
    if (playerUUID != null && String(contribution?.parent || '') !== String(playerUUID)) return total;
    const value = Number(contribution?.value);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

// Road progression is permanent: only positive authoritative records add to
// lifetime Contribution. Negative Goal adjustments remain visible in Goal
// analytics but can never revoke recognition or unlocks.
export function getLifetimeContributionTotal(contributions = [], playerUUID = null) {
  return Math.floor((contributions || []).reduce((total, contribution) => {
    if (playerUUID != null && String(contribution?.parent || '') !== String(playerUUID)) return total;
    const value = Number(contribution?.value);
    return total + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0));
}

export function getGoalStatus(goal) {
  if (!goal) return 'active';
  if (goal.lifecycleStatus) return goal.lifecycleStatus;
  if (goal.status === 'archived' || goal.archivedAt) return 'archived';
  if (goal.status === 'completed' || goal.completedAt) return 'completed';
  if (goal.status === 'paused') return 'paused';
  return 'active';
}

export function isGoalActive(goal) {
  return Boolean(goal) && getGoalStatus(goal) === 'active';
}

export function isGoalTaskCategory(goal) {
  return Boolean(goal) && goal.taskCategoryEnabled !== false && goal.hideFromTasks !== true;
}

export function buildContributionByPlayer(contributions = []) {
  return contributions.reduce((totals, contribution) => {
    if (!contribution.parent) return totals;
    const value = Number(contribution.value);
    totals[contribution.parent] = (totals[contribution.parent] || 0)
      + (Number.isFinite(value) ? value : 0);
    return totals;
  }, {});
}

export function buildContributionByGoal(contributions = [], goals = [], playerUUID = null) {
  const goalsByUUID = Object.fromEntries((goals || []).map((goal) => [goal.UUID, goal]));
  const totals = new Map();

  for (const contribution of contributions) {
    if (playerUUID && String(contribution.parent) !== String(playerUUID)) continue;
    const goalUUID = contribution.goalUUID;
    if (!goalUUID) continue;
    const current = totals.get(goalUUID) || {
      goalUUID,
      name: goalsByUUID[goalUUID]?.name || contribution.goalNameSnapshot || 'Deleted Goal',
      value: 0,
      color: goalsByUUID[goalUUID]?.accentColor || '#4da3ff',
    };
    {
      const value = Number(contribution.value);
      current.value += Number.isFinite(value) ? value : 0;
    }
    totals.set(goalUUID, current);
  }

  return [...totals.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

export function buildGoalLeaderboard(contributions = [], players = [], goalUUID) {
  const playersByUUID = Object.fromEntries((players || []).map((player) => [player.UUID, player]));
  const totals = buildContributionByPlayer(
    contributions.filter((contribution) => String(contribution.goalUUID) === String(goalUUID)),
  );
  return Object.entries(totals)
    .map(([playerUUID, value]) => ({
      playerUUID,
      value,
      player: playersByUUID[playerUUID] || {
        UUID: playerUUID,
        username: contributions.find((entry) => entry.parent === playerUUID)?.playerNameSnapshot || 'Deleted User',
      },
    }))
    .sort((a, b) => b.value - a.value || String(a.player.username || '').localeCompare(String(b.player.username || '')));
}

export function buildContributionTrend(contributions = [], goalUUID, days = 14) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const points = [];
  const totals = {};

  for (const contribution of contributions) {
    if (String(contribution.goalUUID) !== String(goalUUID)) continue;
    const date = new Date(contribution.createdAt || contribution.completedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toLocaleDateString('en-CA');
    {
      const value = Number(contribution.value);
      totals[key] = (totals[key] || 0) + (Number.isFinite(value) ? value : 0);
    }
  }

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    const key = date.toLocaleDateString('en-CA');
    points.push({ key, label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), value: totals[key] || 0 });
  }
  return points;
}



export const CONTRIBUTION_ACTION_VALUES = Object.freeze({
  habit: 1,
  quantity: 1,
  duration: 1,
  dojo: 1,
  match: 3,
  'task-session': 2,
  'goal-completed': 5,
});

/**
 * Record one idempotent contribution award for a concrete app action.
 * sourceUUID must identify the underlying action so retries/background jobs
 * cannot double-award Contribution.
 */
export async function recordActionContribution(databaseConnection, player, {
  source,
  sourceUUID,
  value = null,
  summary = '',
  goalUUID = null,
  taskUUID = null,
  todoUUID = null,
  completionEventUUID = null,
  createdAt = null,
  inGameTimestamp = null,
} = {}) {
  if (!databaseConnection || !player?.UUID || !source || !sourceUUID) return null;
  if (!Object.hasOwn(CONTRIBUTION_ACTION_VALUES, source) && value == null) return null;
  if (['journal', 'journal-comment', 'day-start', 'day-end'].includes(source)) return null;
  const UUID = `action-contribution:${source}:${player.UUID}:${sourceUUID}`;
  const existing = await databaseConnection.get(STORES.contribution, UUID).catch(() => null);
  if (existing) return existing;

  const resolved = value == null ? CONTRIBUTION_ACTION_VALUES[source] : Number(value);
  const amount = Number.isFinite(Number(resolved)) ? Number(resolved) : 0;
  if (amount === 0) return null;
  const timestamp = createdAt || new Date().toISOString();
  const contribution = {
    UUID,
    parent: player.UUID,
    goalUUID,
    taskUUID,
    todoUUID,
    completionEventUUID,
    source,
    direction: amount < 0 ? 'negative' : 'positive',
    summary: String(summary || source).slice(0, 240),
    taskName: String(summary || source).slice(0, 240),
    value: amount,
    rewardBand: null,
    rewardRarity: null,
    rewardCoins: 0,
    playerNameSnapshot: player.username || 'Unknown',
    goalNameSnapshot: null,
    createdAt: timestamp,
    completedAt: timestamp,
    ...(Number.isFinite(Number(inGameTimestamp)) ? { inGameTimestamp: Number(inGameTimestamp) } : {}),
  };
  await databaseConnection.add(STORES.contribution, contribution);
  return contribution;
}

export function getUnlockedContributionRewards(totalContribution = 0) {
  const total = Math.max(0, Number(totalContribution) || 0);
  return CONTRIBUTION_PASS_REWARDS.filter((reward) => total >= reward.threshold);
}

export function getNextContributionReward(totalContribution = 0) {
  const total = Math.max(0, Number(totalContribution) || 0);
  return CONTRIBUTION_PASS_REWARDS.find((reward) => reward.threshold > total) || null;
}

export async function recordTaskContribution(databaseConnection, player, task, reward = null, {
  completionEventUUID = null,
} = {}) {
  if (!player?.UUID || !task?.UUID) return null;

  const existing = completionEventUUID
    ? (await databaseConnection.getAll(STORES.contribution))
      .find((entry) => entry.completionEventUUID === completionEventUUID)
    : await databaseConnection.getContributionForTask(task.UUID);
  if (existing) return existing;

  const goalUUID = task?.projectId || null;
  const goal = goalUUID ? await databaseConnection.get(STORES.project, goalUUID) : null;
  const resolvedReward = reward || buildActionReward({
    actionType: 'task',
    seed: task.UUID,
    baseCoins: task.rewardBaseCoins || 0,
  });
  const contribution = {
    UUID: completionEventUUID ? `task-completion:${completionEventUUID}:contribution` : uuid(),
    parent: player.UUID,
    goalUUID,
    taskUUID: task.UUID,
    todoUUID: task.todoUUID || null,
    taskName: task.name || 'Completed task',
    summary: task.name || 'Completed task',
    source: 'task',
    completionEventUUID,
    playerNameSnapshot: player.username || 'Unknown',
    goalNameSnapshot: goal?.name || task.goalName || task.projectName || null,
    value: Number(resolvedReward.contribution) || 0,
    rewardBand: resolvedReward.bandId || null,
    rewardRarity: resolvedReward.rarity || null,
    rewardCoins: Number(resolvedReward.coins || 0),
    createdAt: task.completedAt || new Date().toISOString(),
    completedAt: task.completedAt || new Date().toISOString(),
  };
  await databaseConnection.add(STORES.contribution, contribution);
  return contribution;
}

export async function recordGoalContribution(databaseConnection, player, task, reward = null) {
  if (!task?.projectId) return null;
  return recordTaskContribution(databaseConnection, player, task, reward);
}

export async function recordManualContribution(databaseConnection, player, goal, {
  summary = '',
  direction = 'positive',
} = {}) {
  if (!player?.UUID || !goal?.UUID) return null;
  const now = new Date().toISOString();
  const cleanSummary = String(summary || '').trim().slice(0, 240) || 'Manual contribution report';
  const reward = buildActionReward({
    actionType: 'manual-contribution',
    seed: [goal.UUID, player.UUID, cleanSummary, now].join(':'),
    direction,
  });
  const contribution = {
    UUID: uuid(),
    parent: player.UUID,
    goalUUID: goal.UUID,
    taskUUID: null,
    todoUUID: null,
    taskName: cleanSummary,
    summary: cleanSummary,
    source: 'manual',
    direction: reward.direction,
    playerNameSnapshot: player.username || 'Unknown',
    goalNameSnapshot: goal.name || 'Goal',
    value: Number(reward.contribution) || 0,
    rewardBand: reward.bandId || null,
    rewardRarity: reward.rarity || null,
    rewardCoins: 0,
    createdAt: now,
    completedAt: now,
  };
  await databaseConnection.add(STORES.contribution, contribution);
  return { contribution, reward };
}

export async function claimContributionPassReward(
  databaseConnection,
  playerUUID,
  rewardId,
  contributions = null,
  _options = {},
) {
  if (!playerUUID || !rewardId) return [];
  const reward = CONTRIBUTION_PASS_REWARDS.find((entry) => entry.id === rewardId);
  if (!reward) {
    const error = new Error('The requested Contribution Road reward does not exist.');
    error.code = 'contribution-reward-not-found';
    throw error;
  }
  const rows = contributions || await databaseConnection.getPlayerStore(STORES.contribution, playerUUID);
  const total = getLifetimeContributionTotal(rows, playerUUID);
  if (total < reward.threshold) {
    const error = new Error(`Reach ${reward.threshold} Contribution before claiming this reward.`);
    error.code = 'contribution-reward-locked';
    error.details = { rewardId, threshold: reward.threshold, total };
    throw error;
  }
  const inventory = await databaseConnection.getPlayerStore(STORES.inventory, playerUUID);
  const owned = new Set([
    'minimalist',
    ...inventory.flatMap((item) => [item.itemId, item.name].filter(Boolean)),
  ]);
  const granted = [];
  const claimedAt = new Date().toISOString();

  for (const item of reward.items || []) {
    if (item.type === 'cosmetic_theme' && item.id === 'minimalist') continue;
    if (owned.has(item.id)) continue;
    await databaseConnection.add(STORES.inventory, {
      UUID: uuid(),
      parent: playerUUID,
      itemId: item.id,
      name: item.label,
      type: item.type,
      quantity: 1,
      cost: 0,
      contributionThreshold: reward.threshold,
      contributionRewardId: reward.id,
      unlockedByContribution: true,
      claimedAt,
      createdAt: claimedAt,
    });
    owned.add(item.id);
    granted.push({ ...item, rewardId: reward.id, threshold: reward.threshold });
  }
  return granted;
}

export async function archiveGoal(databaseConnection, goal) {
  const now = new Date().toISOString();
  await databaseConnection.add(STORES.project, {
    ...goal,
    lifecycleStatus: 'archived',
    status: 'archived',
    archivedAt: now,
    updatedAt: now,
  });
}

export async function restoreGoal(databaseConnection, goal) {
  const next = {
    ...goal,
    lifecycleStatus: 'active',
    status: 'active',
    archivedAt: null,
    completedAt: null,
    updatedAt: new Date().toISOString(),
  };
  await databaseConnection.add(STORES.project, next);
}

export async function deleteArchivedGoal(databaseConnection, goalUUID) {
  await databaseConnection.remove(STORES.project, goalUUID);
}
