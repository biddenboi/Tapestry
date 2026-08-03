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

export function getGoalStatus(goal) {
  if (!goal) return 'active';
  return goal.status === 'archived' || Boolean(goal.archivedAt || goal.completedAt)
    ? 'archived'
    : 'active';
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
    const goalUUID = contribution.goalUUID || contribution.projectId;
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
    contributions.filter((contribution) => String(contribution.goalUUID || contribution.projectId) === String(goalUUID)),
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
    if (String(contribution.goalUUID || contribution.projectId) !== String(goalUUID)) continue;
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

export function getUnlockedContributionRewards(totalContribution = 0) {
  const total = Math.max(0, Number(totalContribution) || 0);
  return CONTRIBUTION_PASS_REWARDS.filter((reward) => total >= reward.threshold);
}

export function getContributionUnlockedCosmeticIds(totalContribution = 0) {
  return new Set(
    getUnlockedContributionRewards(totalContribution)
      .flatMap((reward) => reward.items || [])
      .flatMap((item) => [item.id, item.type].filter(Boolean)),
  );
}

export function getNextContributionReward(totalContribution = 0) {
  const total = Math.max(0, Number(totalContribution) || 0);
  return CONTRIBUTION_PASS_REWARDS.find((reward) => reward.threshold > total) || null;
}

export async function recordTaskContribution(databaseConnection, player, task, reward = null, {
  completionEventUUID = null,
  flush = true,
} = {}) {
  if (!player?.UUID || !task?.UUID) return null;

  const existing = completionEventUUID
    ? (await databaseConnection.getAll(STORES.contribution))
      .find((entry) => entry.completionEventUUID === completionEventUUID)
    : await databaseConnection.getContributionForTask(task.UUID);
  if (existing) return existing;

  const goalUUID = task?.projectId || task?.goalId || null;
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
  if (flush) await databaseConnection.flushLinkedFolderWrite?.();
  return contribution;
}

export async function recordGoalContribution(databaseConnection, player, task, reward = null) {
  if (!task?.projectId && !task?.goalId) return null;
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
  await databaseConnection.flushLinkedFolderWrite?.();
  return { contribution, reward };
}

export async function syncContributionPassRewards(databaseConnection, playerUUID, contributions = null, { flush = true } = {}) {
  if (!playerUUID) return [];
  const rows = contributions || await databaseConnection.getPlayerStore(STORES.contribution, playerUUID);
  const total = Math.max(0, getContributionTotal(rows, playerUUID));
  const rewards = getUnlockedContributionRewards(total);
  const inventory = await databaseConnection.getPlayerStore(STORES.inventory, playerUUID);
  const owned = new Set(['default', ...inventory.flatMap((item) => [item.itemId, item.type, item.name].filter(Boolean))]);
  const granted = [];

  for (const reward of rewards) {
    for (const item of reward.items || []) {
      if (item.type === 'cosmetic_theme' && item.id === 'default') continue;
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
        unlockedByContribution: true,
        createdAt: new Date().toISOString(),
      });
      owned.add(item.id);
      granted.push({ ...item, threshold: reward.threshold });
    }
  }
  if (granted.length > 0 && flush) await databaseConnection.flushLinkedFolderWrite?.();
  return granted;
}

export async function archiveGoal(databaseConnection, goal) {
  const now = new Date().toISOString();
  await databaseConnection.add(STORES.project, {
    ...goal,
    status: 'archived',
    archivedAt: now,
    completedAt: goal.completedAt || now,
    updatedAt: now,
  });

  const todos = await databaseConnection.getAll(STORES.todo);
  for (const todo of todos.filter((entry) => entry.projectId === goal.UUID)) {
    await databaseConnection.add(STORES.todo, { ...todo, projectId: null });
  }
  await databaseConnection.flushLinkedFolderWrite?.();
}

export async function restoreGoal(databaseConnection, goal) {
  const next = { ...goal, status: 'active', archivedAt: null, completedAt: null, updatedAt: new Date().toISOString() };
  await databaseConnection.add(STORES.project, next);
  await databaseConnection.flushLinkedFolderWrite?.();
}

export async function deleteArchivedGoal(databaseConnection, goalUUID) {
  await databaseConnection.remove(STORES.project, goalUUID);
  await databaseConnection.flushLinkedFolderWrite?.();
}
