import { computeRarity, getAchievementByKey, getRarityLabel } from '@domain/achievements/Achievements.js';
import { STORES } from '@domain/constants.js';
import { getProfileMatchOutcome } from '@domain/profile/Profile.js';
import { getRankLabel } from '@domain/rank/Rank.js';

const atOf = (record) => record?.completedAt || record?.sortAt || record?.createdAt || null;
const igtOf = (record) => Number(record?.completedInGameTimestamp ?? record?.inGameTimestamp ?? 0);
const scoreVotes = (journal) => Object.values(journal?.votes || {}).reduce((sum, value) => sum + Number(value || 0), 0);

function milestone(id, type, title, description, source, importance = 2, tone = 'neutral') {
  return {
    id,
    type,
    title,
    description,
    at: atOf(source),
    inGameTimestamp: igtOf(source),
    importance,
    tone,
    source: source?.UUID ? { store: source._store || null, UUID: source.UUID } : null,
  };
}

export function describeMilestone(entry) {
  return entry?.description || '';
}

export function buildProfileMilestones(profileView, rawRecords = {}, options = {}) {
  const player = rawRecords.player || options.player;
  if (!player) return [];
  const history = rawRecords.history || profileView?.timelineEntries || [];
  const matches = rawRecords.matches || [];
  const allPlayers = rawRecords.allPlayers || [];
  const tasks = history.filter((entry) => entry.type === 'task').sort((a, b) => String(atOf(a)).localeCompare(String(atOf(b))));
  const journals = history.filter((entry) => entry.type === 'journal').sort((a, b) => String(atOf(a)).localeCompare(String(atOf(b))));
  const purchases = history.filter((entry) => entry.type === 'transaction' && entry.originalType !== 'money_log');
  const itemUses = history.filter((entry) => entry.type === 'item_use');
  const completedMatches = matches
    .filter((entry) => entry.status !== 'active')
    .sort((a, b) => igtOf(a) - igtOf(b));
  const rows = [];

  rows.push(milestone(
    `profile-created:${player.UUID}`,
    'profileCreated',
    'Profile Created',
    `${player.username || 'This profile'} entered the system.`,
    { UUID: player.UUID, createdAt: player.createdAt, inGameTimestamp: 0, _store: STORES.player },
    4,
    'rank',
  ));

  if (tasks[0]) rows.push(milestone(
    `first-task:${tasks[0].UUID}`,
    'firstTask',
    'First Task Completed',
    `${tasks[0].name || 'A task'} was the first recorded completion.`,
    { ...tasks[0], _store: STORES.task },
    3,
    'good',
  ));

  const reachedThreshold = [10, 50, 100, 250, 500].filter((value) => tasks.length >= value).pop();
  if (reachedThreshold) {
    const source = tasks[reachedThreshold - 1];
    rows.push(milestone(
      `task-volume:${reachedThreshold}:${player.UUID}`,
      'taskVolumeThreshold',
      `${reachedThreshold} Tasks Completed`,
      `Recorded task output crossed the ${reachedThreshold}-completion mark.`,
      { ...source, _store: STORES.task },
      reachedThreshold >= 100 ? 5 : 4,
      'good',
    ));
  }

  const highestTask = tasks.reduce((best, entry) => (
    !best || Number(entry.points || 0) > Number(best.points || 0) ? entry : best
  ), null);
  if (highestTask) rows.push(milestone(
    `highest-task:${highestTask.UUID}`,
    'highestValueTask',
    'Highest-Value Task',
    `${highestTask.name || 'A task'} produced ${Math.round(Number(highestTask.points || 0)).toLocaleString()} points.`,
    { ...highestTask, _store: STORES.task },
    3,
    'good',
  ));

  if (journals[0]) rows.push(milestone(
    `first-journal:${journals[0].UUID}`,
    'firstJournal',
    'First Journal Post',
    `${journals[0].title || 'Untitled'} opened the profile journal.`,
    { ...journals[0], _store: STORES.journal },
    2,
    'neutral',
  ));

  const topJournal = journals.reduce((best, entry) => (
    !best || scoreVotes(entry) > scoreVotes(best) ? entry : best
  ), null);
  if (topJournal && scoreVotes(topJournal) > 0) rows.push(milestone(
    `top-journal:${topJournal.UUID}`,
    'topVotedJournal',
    'Most Upvoted Journal',
    `“${topJournal.title || 'Untitled'}” reached a vote score of ${scoreVotes(topJournal)}.`,
    { ...topJournal, _store: STORES.journal },
    3,
    'rare',
  ));

  if (completedMatches[0]) rows.push(milestone(
    `first-match:${completedMatches[0].UUID}`,
    'firstMatch',
    'First Match',
    'The first recorded competitive match entered profile history.',
    { ...completedMatches[0], _store: STORES.match },
    3,
    'rank',
  ));

  const firstWin = completedMatches.find((entry) => getProfileMatchOutcome(entry, player.UUID) === 'win');
  if (firstWin) rows.push(milestone(
    `first-win:${firstWin.UUID}`,
    'firstWin',
    'First Match Win',
    `The profile recorded its first competitive victory${firstWin.result?.eloChange ? ` and gained ${firstWin.result.eloChange} ELO` : ''}.`,
    { ...firstWin, _store: STORES.match },
    4,
    'good',
  ));

  const rankUp = completedMatches.find((entry) => {
    const oldLabel = entry.result?.oldElo == null ? null : getRankLabel(entry.result.oldElo);
    const nextLabel = entry.result?.newElo == null ? null : getRankLabel(entry.result.newElo);
    return oldLabel && nextLabel && oldLabel !== nextLabel;
  });
  if (rankUp) rows.push(milestone(
    `rank-up:${rankUp.UUID}`,
    'rankUp',
    'Rank Movement',
    `Moved from ${getRankLabel(rankUp.result.oldElo)} to ${getRankLabel(rankUp.result.newElo)}.`,
    { ...rankUp, _store: STORES.match },
    5,
    'rank',
  ));

  const peakMatch = completedMatches.reduce((best, entry) => (
    Number(entry.result?.newElo || 0) > Number(best?.result?.newElo || 0) ? entry : best
  ), null);
  if (peakMatch?.result?.newElo != null) rows.push(milestone(
    `peak-elo:${peakMatch.UUID}`,
    'highestElo',
    'Peak ELO',
    `Reached a recorded peak of ${Math.round(Number(peakMatch.result.newElo)).toLocaleString()} ELO.`,
    { ...peakMatch, _store: STORES.match },
    4,
    'rank',
  ));

  if (purchases[0]) rows.push(milestone(
    `first-purchase:${purchases[0].UUID}`,
    'firstPurchase',
    'First Shop Purchase',
    `${purchases[0].name || 'An item'} was the first recorded reward purchase.`,
    { ...purchases[0], _store: STORES.transaction },
    2,
    'economy',
  ));

  if (itemUses[0]) rows.push(milestone(
    `first-use:${itemUses[0].UUID}`,
    'firstItemUse',
    'First Reward Used',
    `${itemUses[0].name || 'An inventory item'} moved from inventory into profile history.`,
    { ...itemUses[0], _store: STORES.event },
    2,
    'economy',
  ));

  const rarest = Object.keys(player.achievements || {}).reduce((best, key) => {
    const achievement = getAchievementByKey(key);
    if (!achievement) return best;
    const rarity = computeRarity(key, allPlayers);
    return !best || rarity < best.rarity ? { key, achievement, rarity } : best;
  }, null);
  if (rarest) {
    const earned = player.achievements?.[rarest.key];
    rows.push(milestone(
      `rare-achievement:${rarest.key}:${player.UUID}`,
      'rareAchievement',
      'Rare Achievement',
      `${rarest.achievement.label} is currently classified as ${getRarityLabel(rarest.rarity).label}.`,
      {
        UUID: rarest.key,
        createdAt: earned?.earnedAt || player.createdAt,
        inGameTimestamp: earned?.inGameTimestamp || 0,
        _store: STORES.player,
      },
      4,
      'rare',
    ));
  }

  return rows
    .filter((entry) => entry.at)
    .sort((a, b) => String(a.at).localeCompare(String(b.at))
      || Number(a.importance || 0) - Number(b.importance || 0));
}

export function classifyProfileArc(stats = {}) {
  const recent = Number(stats.taskStats?.recent7Points || 0);
  const baseline = Number(stats.taskStats?.baselineDailyPoints || 0) * 7;
  const journals = Number(stats.journalStats?.recentCount || 0);
  const tasks = Number(stats.taskStats?.recent7Count || 0);
  const spend = Number(stats.economyStats?.recentSpend || 0);
  const earned = Number(stats.economyStats?.recentEarned || 0);
  const recentElo = Number(stats.matchStats?.recentEloChange || 0);
  const recovered = stats.matchStats?.recovered === true;

  if (recovered && recent >= baseline) return 'recovery';
  if (recentElo >= 50 && Number(stats.matchStats?.recentMatches || 0) >= 2) return 'competitivePush';
  if (baseline > 0 && recent > baseline * 1.25) return 'momentum';
  if (journals >= 3 && journals > tasks) return 'reflectionHeavy';
  if (spend > 0 && spend > Math.max(1, earned) * 0.5) return 'economyHeavy';
  if (tasks + journals + Number(stats.matchStats?.recentMatches || 0) < 2) return 'lowSignal';
  return 'quietBuild';
}

const ARC_COPY = {
  momentum: ['Task output is up', 'You completed more task output than your recent average.'],
  recovery: ['Output recovered', 'Task output increased after a recent drop.'],
  quietBuild: ['Steady activity', 'Your recent tasks, posts, and matches are balanced.'],
  competitivePush: ['Rank push', 'Matches and ELO changes lead your recent activity.'],
  reflectionHeavy: ['More posts this week', 'You posted more often than you completed tasks.'],
  economyHeavy: ['More shop activity', 'Purchases and item use lead your recent activity.'],
  lowSignal: ['No profile activity yet', 'Complete a task, play a match, or share a post to build your history.'],
};

export function buildProfileArcSummary(profileView, rawRecords = {}, options = {}) {
  const stats = options.stats || rawRecords.stats || {};
  const type = classifyProfileArc(stats);
  const [title, description] = ARC_COPY[type] || ARC_COPY.lowSignal;
  return { type, title, description };
}

export async function buildProfileSnapshotAtIGT(databaseConnection, profileUUID, viewerIGT) {
  const [player, tasks, journals, events, transactions, matches, contributions] = await Promise.all([
    databaseConnection.getPlayerAtIGT(profileUUID, viewerIGT),
    databaseConnection.getPlayerStoreThroughIGT(STORES.task, profileUUID, viewerIGT),
    databaseConnection.getPlayerStoreThroughIGT(STORES.journal, profileUUID, viewerIGT),
    databaseConnection.getPlayerStoreThroughIGT(STORES.event, profileUUID, viewerIGT),
    databaseConnection.getPlayerStoreThroughIGT(STORES.transaction, profileUUID, viewerIGT),
    databaseConnection.getVisibleMatchesForPlayer(profileUUID, viewerIGT),
    databaseConnection.getPlayerStoreThroughIGT(STORES.contribution, profileUUID, viewerIGT),
  ]);
  const completedTasks = tasks.filter((task) => task.completedAt);
  const completedMatches = matches.filter((match) => match.status !== 'active');
  const wins = completedMatches.filter((match) => getProfileMatchOutcome(match, profileUUID) === 'win').length;
  const spent = transactions
    .filter((entry) => entry.type === 'shop_purchase')
    .reduce((sum, entry) => sum + Number(entry.totalCost ?? entry.cost ?? 0), 0);
  const earned = transactions
    .filter((entry) => entry.type === 'money_log')
    .reduce((sum, entry) => sum + Number(entry.amount ?? entry.cost ?? 0), 0);
  return {
    player,
    viewerIGT,
    tasks,
    journals,
    events,
    transactions,
    matches,
    contributions,
    summary: {
      elo: Number(player?.elo || 0),
      tasks: completedTasks.length,
      journals: journals.length,
      matches: completedMatches.length,
      wins,
      losses: Math.max(0, completedMatches.length - wins),
      spent,
      earned,
      contribution: contributions.reduce((sum, entry) => sum + Number(entry.value || 0), 0),
    },
  };
}
