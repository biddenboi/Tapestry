import { computeRarity, getAchievementByKey, getRarityLabel } from '@domain/achievements/Achievements.js';
import { DAY } from '@domain/constants.js';
import { buildProfileMilestones } from '@domain/profile/ProfileBiography.js';
import { getProfileMatchOutcome } from '@domain/profile/Profile.js';

const dayKey = (value) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-CA');
};

const voteScore = (journal) => Object.values(journal?.votes || {}).reduce((sum, value) => sum + Number(value || 0), 0);

export function buildProfileStatsFromRecords(records, player, viewerIGT) {
  const tasks = (records.tasks || []).filter((task) => task.completedAt);
  const journals = records.journals || [];
  const matches = (records.matches || []).filter((match) => match.status !== 'active');
  const transactions = records.transactions || [];
  const inventory = records.inventory || [];
  const allPlayers = records.allPlayers || [];
  const contributions = records.contributions || [];
  const now = Date.now();
  const last7 = now - 7 * DAY;
  const last30 = now - 30 * DAY;
  const prior30 = now - 60 * DAY;

  const taskDaily = {};
  for (const task of tasks) {
    const key = dayKey(task.completedAt || task.createdAt);
    if (!key) continue;
    if (!taskDaily[key]) taskDaily[key] = { x: key, points: 0, count: 0 };
    taskDaily[key].points += Number(task.points || 0);
    taskDaily[key].count += 1;
  }
  const taskSeries = Object.values(taskDaily).sort((a, b) => a.x.localeCompare(b.x)).slice(-30);
  const recentTasks = tasks.filter((task) => new Date(task.completedAt || task.createdAt).getTime() >= last7);
  const baselineTasks = tasks.filter((task) => {
    const time = new Date(task.completedAt || task.createdAt).getTime();
    return time >= last30 && time < last7;
  });
  const recent7Points = recentTasks.reduce((sum, task) => sum + Number(task.points || 0), 0);
  const baselineDailyPoints = baselineTasks.reduce((sum, task) => sum + Number(task.points || 0), 0) / 23;

  const topJournal = journals.reduce((best, entry) => (
    !best || voteScore(entry) > voteScore(best) ? entry : best
  ), null);
  const recentJournalCount = journals.filter((entry) => new Date(entry.createdAt).getTime() >= last7).length;

  const sortedMatches = [...matches].sort((a, b) => (
    Number(a.completedInGameTimestamp ?? a.inGameTimestamp ?? 0)
    - Number(b.completedInGameTimestamp ?? b.inGameTimestamp ?? 0)
  ));
  const eloSeries = sortedMatches
    .filter((match) => match.result?.newElo != null)
    .map((match) => ({
      x: Number(match.completedInGameTimestamp ?? match.inGameTimestamp ?? 0),
      y: Number(match.result.newElo),
    }));
  const recentMatches = sortedMatches.filter((match) => new Date(match.result?.concludedAt || match.createdAt).getTime() >= last30);
  const recentEloChange = recentMatches.reduce((sum, match) => sum + Number(match.result?.eloChange || 0), 0);
  const recentDeltas = recentMatches.map((match) => Number(match.result?.eloChange || 0));
  const recovered = recentDeltas.length >= 2
    && Math.min(...recentDeltas.slice(0, -1)) < 0
    && recentDeltas.slice(-2).reduce((sum, value) => sum + value, 0) > 0;
  const wins = matches.filter((match) => getProfileMatchOutcome(match, player.UUID) === 'win').length;

  const purchases = transactions.filter((entry) => entry.type === 'shop_purchase');
  const recentPurchases = purchases.filter((entry) => new Date(entry.completedAt || entry.createdAt).getTime() >= last30);
  const spendByCategory = {};
  for (const entry of recentPurchases) {
    const category = entry.category || 'Other';
    spendByCategory[category] = (spendByCategory[category] || 0) + Number(entry.totalCost ?? entry.cost ?? 0);
  }
  const recentSpend = Object.values(spendByCategory).reduce((sum, value) => sum + value, 0);
  const recentEarned = transactions
    .filter((entry) => entry.type === 'money_log' && new Date(entry.completedAt || entry.createdAt).getTime() >= last30)
    .reduce((sum, entry) => sum + Number(entry.amount ?? entry.cost ?? 0), 0);
  const economyBreakdown = Object.entries(spendByCategory)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const largestPurchase = [...purchases]
    .sort((a, b) => Number(b.totalCost || b.cost || 0) - Number(a.totalCost || a.cost || 0))[0] || null;

  const mostUsed = [...inventory].sort((a, b) => Number(b.useCount || 0) - Number(a.useCount || 0))[0] || null;
  const rarestAchievement = Object.keys(player.achievements || {}).reduce((best, key) => {
    const achievement = getAchievementByKey(key);
    if (!achievement) return best;
    const rarity = computeRarity(key, allPlayers);
    return !best || rarity < best.rarity ? {
      key,
      label: achievement.label,
      rarity,
      rarityLabel: getRarityLabel(rarity).label,
    } : best;
  }, null);

  const projectTotals = {};
  for (const contribution of contributions) {
    const key = contribution.goalUUID || 'ungrouped';
    projectTotals[key] = (projectTotals[key] || 0) + Number(contribution.value || 0);
  }

  const history = [
    ...tasks.map((entry) => ({ ...entry, type: 'task' })),
    ...journals.map((entry) => ({ ...entry, type: 'journal' })),
    ...(records.events || []).map((entry) => ({ ...entry, type: entry.type === 'item_use' ? 'item_use' : 'event' })),
    ...transactions.map((entry) => ({ ...entry, originalType: entry.type, type: entry.type === 'money_log' ? 'money_log' : 'transaction' })),
  ];
  const milestones = buildProfileMilestones(null, {
    player,
    history,
    matches,
    allPlayers,
  }).map((entry) => ({
    id: entry.id,
    type: entry.type,
    title: entry.title,
    description: entry.description,
    at: entry.at,
    inGameTimestamp: entry.inGameTimestamp,
    importance: entry.importance,
    tone: entry.tone,
    source: entry.source,
  }));

  return {
    viewerIGT,
    taskSeries: taskSeries.map((entry) => ({ x: entry.x, y: entry.points })),
    taskStats: {
      total: tasks.length,
      totalPoints: tasks.reduce((sum, task) => sum + Number(task.points || 0), 0),
      recent7Count: recentTasks.length,
      recent7Points,
      baselineDailyPoints,
      prior30Points: tasks
        .filter((task) => {
          const time = new Date(task.completedAt || task.createdAt).getTime();
          return time >= prior30 && time < last30;
        })
        .reduce((sum, task) => sum + Number(task.points || 0), 0),
    },
    journalStats: {
      total: journals.length,
      recentCount: recentJournalCount,
      spotlight: topJournal ? {
        UUID: topJournal.UUID,
        title: topJournal.title || 'Untitled',
        excerpt: String(topJournal.entry || '').slice(0, 150),
        score: voteScore(topJournal),
      } : null,
    },
    matchStats: {
      total: matches.length,
      wins,
      losses: Math.max(0, matches.length - wins),
      recentMatches: recentMatches.length,
      recentEloChange,
      recovered,
      eloSeries: eloSeries.slice(-16),
      currentElo: Number(player.elo || 0),
    },
    economyStats: {
      recentSpend,
      recentEarned,
      breakdown: economyBreakdown,
      largestPurchase: largestPurchase
        ? {
          UUID: largestPurchase.UUID,
          name: largestPurchase.name,
          value: Number(largestPurchase.totalCost ?? largestPurchase.cost ?? 0),
        } : null,
    },
    inventoryStats: {
      total: inventory.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0),
      mostUsed: mostUsed ? {
        UUID: mostUsed.UUID,
        name: mostUsed.name,
        useCount: Number(mostUsed.useCount || 0),
        cooldownUntil: mostUsed.cooldownUntil || null,
      } : null,
    },
    achievementStats: {
      total: Object.keys(player.achievements || {}).length,
      rarest: rarestAchievement,
    },
    projectTotals,
    milestones,
  };
}
