import { getAchievementByKey, computeRarity, getRarityLabel } from '@domain/achievements/Achievements.js';
import { getRankLabel } from '@domain/rank/Rank.js';
import { getMatchOutcomeForPlayer } from '@domain/matches/Match.js';
import {
  buildPlayerEloTimeline,
  projectPlayerEloTimeline,
} from '@domain/matches/IGT.js';
import { isRatedMatch } from '@domain/matches/RatingMode.js';
import { getCanonicalTaskPoints } from '@domain/tasks/Tasks.js';

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

function completedRecordIGT(record) {
  for (const value of [record?.completedInGameTimestamp, record?.result?.inGameTimestamp]) {
    if (value == null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  const started = Number(record?.inGameTimestamp);
  if (Number.isFinite(started)) return Math.max(0, started);
  for (const value of [record?.completedInGameTimestamp, record?.result?.inGameTimestamp]) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.max(0, numeric);
  }
  return 0;
}
const completedMatchIGT = (match) => completedRecordIGT(match);

export const PROFILE_TIMELINE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'task', label: 'Tasks' },
  { id: 'journal', label: 'Posts' },
  { id: 'match', label: 'Matches' },
  { id: 'rank', label: 'Rank' },
  { id: 'event', label: 'Events' },
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
  const eloChange = isRatedMatch(match) ? match.result?.eloChange : null;
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

function buildEloSeries({ player, matches, viewerIGT = Infinity }) {
  const boundary = Number.isFinite(Number(viewerIGT)) ? Math.max(0, Number(viewerIGT)) : Infinity;
  const timeline = buildPlayerEloTimeline(player, matches, {
    reconcileCurrent: true,
  });
  const projected = projectPlayerEloTimeline(timeline, boundary);
  if (!projected.hasVisibleRating) {
    return {
      points: [],
      limited: false,
      note: 'Complete a rated competition to establish your Elo.',
      hasVisibleRating: false,
      displayElo: null,
    };
  }

  return {
    points: projected.eloHistory,
    limited: false,
    note: '',
    hasVisibleRating: true,
    displayElo: projected.elo,
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
  const withElo = completed.filter((match) => isRatedMatch(match) && match.result?.eloChange != null);
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
    !best || getCanonicalTaskPoints(item) > getCanonicalTaskPoints(best) ? item : best
  ), null);
  const bestMatch = matches.find((match) => getProfileMatchOutcome(match, player.UUID) === 'win') || matches[0] || null;
  const rankShift = matches.find((match) => {
    if (!isRatedMatch(match)) return false;
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
      value: rankShift
        ? getRankLabel(rankShift.result.newElo)
        : player.hasVisibleRating ? getRankLabel(player.elo || 0) : 'Unrated',
      detail: rankShift
        ? `${getRankLabel(rankShift.result.oldElo)} to ${getRankLabel(rankShift.result.newElo)}`
        : player.hasVisibleRating
          ? 'No recorded rank shift yet.'
          : 'Complete a rated competition to establish your rank.',
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

export function buildProfileViewModel({
  player,
  history = [],
  matches = [],
  allPlayers = [],
  currentPlayerUUID = null,
  viewerIGT = Infinity,
}) {
  if (!player) return null;

  const boundary = Number.isFinite(Number(viewerIGT)) ? Math.max(0, Number(viewerIGT)) : Infinity;
  const sortedMatches = [...matches]
    .filter((match) => completedMatchIGT(match) <= boundary)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const tasks = history.filter((item) => item.type === 'task');
  const journals = history.filter((item) => item.type === 'journal');
  const events = history.filter((item) => item.type === 'event');
  const achievementsEarned = Object.keys(player.achievements || {}).length;
  const totalPoints = tasks.reduce((sum, item) => sum + getCanonicalTaskPoints(item), 0);
  const matchSummary = buildMatchSummary(sortedMatches, player.UUID);
  const eloHistory = buildEloSeries({ player, matches, currentPlayerUUID, viewerIGT: boundary });
  const displayElo = eloHistory.hasVisibleRating ? eloHistory.displayElo : null;
  const projectedPlayer = {
    ...player,
    elo: displayElo ?? Number(player.igtBaseElo ?? player.elo ?? 0),
    hasVisibleRating: eloHistory.hasVisibleRating,
  };
  const timelineEntries = [
    ...history,
    ...sortedMatches.map((match) => makeMatchTimelineEntry(match, player.UUID)),
  ];

  return {
    summaryStats: [
      { id: 'points', label: 'Lifetime pts', value: formatInt(totalPoints) },
      { id: 'elo', label: 'Current Elo', value: eloHistory.hasVisibleRating ? formatInt(displayElo) : 'Unrated' },
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
    hasVisibleRating: eloHistory.hasVisibleRating,
    displayElo,
    matchSummary,
    timelineEntries,
    highlightCards: buildHighlights({
      player: projectedPlayer,
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
