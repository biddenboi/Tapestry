import { getAchievementByKey, computeRarity, getRarityLabel } from '@domain/achievements/Achievements.js';
import { getRankLabel } from '@domain/rank/Rank.js';
import { getMatchOutcomeForPlayer } from '@domain/matches/Match.js';

const DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const toTime = (value) => {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

const formatInt = (value) => Math.round(Number(value) || 0).toLocaleString();

export const PROFILE_TIMELINE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'task', label: 'Tasks' },
  { id: 'journal', label: 'Posts' },
  { id: 'match', label: 'Matches' },
  { id: 'rank', label: 'Rank' },
  { id: 'event', label: 'Habits' },
  { id: 'contribution', label: 'Goals' },
  { id: 'item', label: 'Items' },
  { id: 'economy', label: 'Economy' },
];

export function getProfileMatchOutcome(match, playerUUID) {
  return getMatchOutcomeForPlayer(match, playerUUID).status;
}

function timelineKind(item) {
  if (item.type === 'item_use') return 'item';
  if (item.type === 'money_log' || item.type === 'transaction') return 'economy';
  return item.type || 'event';
}

function timelineSearchText(item) {
  return [
    item.name,
    item.title,
    item.description,
    item.entry,
    item.type,
    item.result?.winner ? `winner team ${item.result.winner}` : '',
  ].filter(Boolean).join(' ').toLowerCase();
}

function makeMatchTimelineEntry(match, playerUUID) {
  const outcome = getProfileMatchOutcome(match, playerUUID);
  const eloChange = match.result?.eloChange;
  const eloLabel = eloChange == null ? '' : `${eloChange > 0 ? '+' : ''}${eloChange} ELO`;
  return {
    ...match,
    type: 'match',
    sortAt: match.result?.concludedAt || match.createdAt,
    name: outcome === 'live'
      ? 'Live match'
      : outcome === 'forfeit'
        ? 'Match forfeited'
        : `${outcome === 'win' ? 'Match won' : 'Match lost'}`,
    description: [match.duration ? `${match.duration}h match` : 'Match', eloLabel].filter(Boolean).join(' · '),
    profileOutcome: outcome,
  };
}

function buildEloSeries({ player, matches, currentPlayerUUID }) {
  const currentElo = Number(player?.elo || 0);
  const isSelf = player?.UUID && currentPlayerUUID && String(player.UUID) === String(currentPlayerUUID);
  const completed = [...(matches || [])]
    .filter((match) => match.result?.eloChange != null)
    .sort((a, b) => (
      Number(a.completedInGameTimestamp ?? a.result?.inGameTimestamp ?? 0)
      - Number(b.completedInGameTimestamp ?? b.result?.inGameTimestamp ?? 0)
    ));

  if (!isSelf || completed.length === 0) {
    return {
      points: [],
      limited: !isSelf,
      note: isSelf
        ? 'Play completed matches to build an ELO graph.'
        : 'Detailed ELO history is only tracked for the active profile in existing match records.',
    };
  }

  let runElo = Math.max(0, Number(completed[0].result?.oldElo ?? player?.igtBaseElo ?? 0));
  const firstTime = Number(
    completed[0].completedInGameTimestamp
    ?? completed[0].result?.inGameTimestamp
    ?? 0,
  );
  const points = [{ t: Math.max(0, firstTime - 1000), elo: runElo }];

  for (const match of completed) {
    runElo = Math.max(0, Number(
      match.result?.newElo
      ?? runElo + Number(match.result?.eloChange || 0),
    ));
    points.push({
      t: Number(match.completedInGameTimestamp ?? match.result?.inGameTimestamp ?? 0),
      elo: runElo,
    });
  }

  points.push({
    t: Math.max(points[points.length - 1]?.t || 0, Number(player?.inGameTime || 0)),
    elo: currentElo,
  });

  return {
    points,
    limited: false,
    note: points.length < 2 ? 'Play completed matches to build an ELO graph.' : '',
  };
}

function buildMatchSummary(matches, playerUUID) {
  const list = matches || [];
  const completed = list.filter((match) => match.status !== 'active' && match.result?.winner != null);
  const wins = completed.filter((match) => getProfileMatchOutcome(match, playerUUID) === 'win').length;
  const losses = completed.filter((match) => (
    ['loss', 'forfeit'].includes(getProfileMatchOutcome(match, playerUUID))
  )).length;
  const live = list.filter((match) => match.status === 'active').length;
  const withElo = completed.filter((match) => match.result?.eloChange != null);
  const totalEloChange = withElo.reduce((sum, match) => sum + Number(match.result?.eloChange || 0), 0);
  const largestGain = withElo.reduce((best, match) => (
    !best || Number(match.result?.eloChange || 0) > Number(best.result?.eloChange || 0) ? match : best
  ), null);

  return {
    total: list.length,
    completed: completed.length,
    wins,
    losses,
    live,
    winRate: completed.length ? Math.round((wins / completed.length) * 100) : 0,
    totalEloChange,
    largestGain: largestGain && Number(largestGain.result?.eloChange || 0) > 0 ? largestGain : null,
    recent: list.slice(0, 6),
  };
}

function buildHighlights({ player, history, matches, allPlayers, matchSummary }) {
  const tasks = history.filter((item) => item.type === 'task');
  const journals = history.filter((item) => item.type === 'journal');
  const pinnedJournal = journals.find((item) => item.pinned) || null;
  const highestTask = tasks.reduce((best, item) => (
    !best || Number(item.points || 0) > Number(best.points || 0) ? item : best
  ), null);
  const bestMatch = matches.find((match) => getProfileMatchOutcome(match, player.UUID) === 'win') || matches[0] || null;
  const rankShift = matches.find((match) => {
    const oldLabel = match.result?.oldElo == null ? null : getRankLabel(match.result.oldElo);
    const newLabel = match.result?.newElo == null ? null : getRankLabel(match.result.newElo);
    return oldLabel && newLabel && oldLabel !== newLabel;
  }) || null;

  const achievementKeys = [
    ...(player.selectedAchievements || []).filter(Boolean),
    ...Object.keys(player.achievements || {}),
  ];
  const uniqueAchievementKeys = [...new Set(achievementKeys)];
  const rarestAchievement = uniqueAchievementKeys.reduce((best, key) => {
    const achievement = getAchievementByKey(key);
    if (!achievement) return best;
    const rarity = computeRarity(key, allPlayers || []);
    if (!best || rarity < best.rarity) return { key, achievement, rarity };
    return best;
  }, null);

  return [
    {
      id: 'best-match',
      label: 'Best recent match',
      value: bestMatch ? getProfileMatchOutcome(bestMatch, player.UUID).toUpperCase() : 'No matches',
      detail: bestMatch ? `${bestMatch.duration || 0}h · ${DAY_FORMATTER.format(new Date(bestMatch.createdAt))}` : 'Compete to create match highlights.',
      item: bestMatch,
      action: bestMatch ? 'match' : null,
      tone: bestMatch && getProfileMatchOutcome(bestMatch, player.UUID) === 'win' ? 'good' : 'neutral',
    },
    {
      id: 'largest-gain',
      label: 'Largest ELO gain',
      value: matchSummary.largestGain ? `+${matchSummary.largestGain.result.eloChange}` : 'No gain yet',
      detail: matchSummary.largestGain ? `${matchSummary.largestGain.duration || 0}h match` : 'Win a match to record an ELO gain.',
      item: matchSummary.largestGain,
      action: matchSummary.largestGain ? 'match' : null,
      tone: 'good',
    },
    {
      id: 'rank-movement',
      label: 'Latest rank movement',
      value: rankShift ? getRankLabel(rankShift.result.newElo) : getRankLabel(player.elo || 0),
      detail: rankShift ? `${getRankLabel(rankShift.result.oldElo)} to ${getRankLabel(rankShift.result.newElo)}` : 'No recorded rank shift yet.',
      item: rankShift,
      action: rankShift ? 'match' : null,
      tone: rankShift ? 'rank' : 'neutral',
    },
    {
      id: 'rare-achievement',
      label: 'Rarest achievement',
      value: rarestAchievement ? rarestAchievement.achievement.label : 'No achievement',
      detail: rarestAchievement ? getRarityLabel(rarestAchievement.rarity).label : 'Unlock or showcase achievements to fill this.',
      action: 'achievements',
      tone: 'rare',
    },
    {
      id: 'pinned-journal',
      label: 'Pinned moment',
      value: pinnedJournal ? (pinnedJournal.title || 'Pinned post') : 'Nothing pinned',
      detail: pinnedJournal ? `${String(pinnedJournal.entry || '').slice(0, 64)}${String(pinnedJournal.entry || '').length > 64 ? '...' : ''}` : 'Pin a post from the timeline.',
      item: pinnedJournal,
      action: pinnedJournal ? 'journal' : null,
      tone: 'neutral',
    },
    {
      id: 'top-task',
      label: 'Highest-value task',
      value: highestTask ? `${formatInt(highestTask.points)} pts` : 'No tasks',
      detail: highestTask ? (highestTask.name || 'Completed task') : 'Complete a task to record a high score.',
      item: highestTask,
      action: highestTask ? 'task' : null,
      tone: 'points',
    },
  ];
}

export function buildProfileViewModel({ player, history = [], matches = [], allPlayers = [], currentPlayerUUID = null }) {
  if (!player) return null;

  const sortedMatches = [...matches].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const tasks = history.filter((item) => item.type === 'task');
  const journals = history.filter((item) => item.type === 'journal');
  const events = history.filter((item) => item.type === 'event');
  const achievementsEarned = Object.keys(player.achievements || {}).length;
  const totalPoints = tasks.reduce((sum, item) => sum + Number(item.points || 0), 0);
  const matchSummary = buildMatchSummary(sortedMatches, player.UUID);
  const eloHistory = buildEloSeries({ player, matches: sortedMatches, currentPlayerUUID });
  const timelineEntries = [
    ...history,
    ...sortedMatches.map((match) => makeMatchTimelineEntry(match, player.UUID)),
  ];

  return {
    summaryStats: [
      { id: 'points', label: 'Lifetime pts', value: formatInt(totalPoints) },
      { id: 'elo', label: 'Current ELO', value: formatInt(player.elo || 0) },
      { id: 'record', label: 'Record', value: `${matchSummary.wins}-${matchSummary.losses}` },
      { id: 'tasks', label: 'Tasks done', value: formatInt(tasks.length) },
      { id: 'journals', label: 'Posts', value: formatInt(journals.length) },
      { id: 'achievements', label: 'Achievements', value: formatInt(achievementsEarned) },
    ],
    totals: {
      totalPoints,
      tasks: tasks.length,
      journals: journals.length,
      events: events.length,
      achievementsEarned,
    },
    eloSeries: eloHistory.points,
    eloLimited: eloHistory.limited,
    eloNote: eloHistory.note,
    matchSummary,
    timelineEntries,
    highlightCards: buildHighlights({
      player,
      history,
      matches: sortedMatches,
      allPlayers,
      matchSummary,
    }),
    emptyStates: {
      hasHistory: timelineEntries.length > 0,
      hasMatches: sortedMatches.length > 0,
      hasEloSeries: eloHistory.points.length >= 2,
    },
  };
}

export function buildProfileTimelineGroups(entries, filters = {}) {
  const {
    type = 'all',
    search = '',
    pinnedOnly = false,
    sort = 'newest',
  } = filters;

  const query = search.trim().toLowerCase();
  const filtered = (entries || []).filter((item) => {
    if (pinnedOnly && !item.pinned) return false;
    if (type !== 'all' && timelineKind(item) !== type) return false;
    if (query && !timelineSearchText(item).includes(query)) return false;
    return true;
  });

  const dir = sort === 'oldest' ? 1 : -1;
  const pinned = filtered
    .filter((item) => item.type === 'journal' && item.pinned)
    .sort((a, b) => (toTime(a.sortAt || a.createdAt) - toTime(b.sortAt || b.createdAt)) * dir);
  const rest = filtered
    .filter((item) => !(item.type === 'journal' && item.pinned))
    .sort((a, b) => (toTime(a.sortAt || a.createdAt || a.completedAt) - toTime(b.sortAt || b.createdAt || b.completedAt)) * dir);

  const groups = [];
  if (pinned.length > 0) {
    groups.push({ key: 'pinned', label: 'Pinned', entries: pinned });
  }

  for (const item of rest) {
    const date = new Date(item.sortAt || item.createdAt || item.completedAt);
    const key = Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleDateString('en-CA');
    const label = Number.isNaN(date.getTime()) ? 'Unknown date' : DAY_FORMATTER.format(date);
    const last = groups[groups.length - 1];
    if (!last || last.key !== key) groups.push({ key, label, entries: [item] });
    else last.entries.push(item);
  }

  return groups;
}
