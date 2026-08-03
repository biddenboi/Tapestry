import { STORES } from '@domain/constants.js';
import {
  bumpSourceVersion,
  isDerivedCacheMetadata,
  sourceVersionsForRecordGroups,
  withDerivedCacheMetadata,
} from '@shared/cache/DerivedCache.js';
import { buildProfileViewModel } from '@domain/profile/Profile.js';
import {
  buildContributionByGoal,
  getContributionTotal,
} from '@domain/contribution/Contribution.js';

export const PROFILE_SUMMARY_SCHEMA_VERSION = 2;
export const PROFILE_SUMMARY_RECENT_LIMIT = 12;
export const PROFILE_SUMMARY_MATCH_LIMIT = 8;
export const PROFILE_SUMMARY_ELO_LIMIT = 32;

export const PROFILE_SUMMARY_SOURCE_STORES = new Set([
  STORES.player,
  STORES.task,
  STORES.journal,
  STORES.event,
  STORES.transaction,
  STORES.match,
  STORES.friendship,
  STORES.inventory,
  STORES.contribution,
  STORES.project,
]);

const PROFILE_SUMMARY_SOURCE_DOMAIN_BY_STORE = Object.freeze({
  [STORES.player]: 'profiles',
  [STORES.task]: 'tasks',
  [STORES.journal]: 'journals',
  [STORES.event]: 'dailyLifecycle',
  [STORES.transaction]: 'shop',
  [STORES.match]: 'matches',
  [STORES.friendship]: 'social',
  [STORES.inventory]: 'inventory',
  [STORES.contribution]: 'competitiveArenas',
  [STORES.project]: 'goals',
});

const asArray = (value) => Array.isArray(value) ? value : [];
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const timeOf = (record = {}) => String(
  record.sortAt
  || record.completedAt
  || record.result?.concludedAt
  || record.updatedAt
  || record.createdAt
  || '',
);

function publicPlayerRecord(player = {}) {
  if (!player?.UUID) return null;
  const next = { ...player };
  delete next.quickNotes;
  return next;
}

function timelineRecord(record, type, sortAt = null) {
  if (!record?.UUID) return null;
  return {
    ...record,
    type,
    sortAt: sortAt || record.completedAt || record.updatedAt || record.createdAt || null,
  };
}

function buildHistory({ tasks = [], journals = [], events = [], transactions = [] } = {}) {
  return [
    ...asArray(tasks)
      .filter((task) => task?.completedAt)
      .map((task) => timelineRecord(task, 'task', task.completedAt || task.createdAt)),
    ...asArray(journals).map((journal) => timelineRecord(journal, 'journal', journal.createdAt)),
    ...asArray(events).map((event) => ({
      ...timelineRecord(event, event.type === 'item_use' ? 'item_use' : 'event', event.createdAt),
      originalType: event.type,
    })),
    ...asArray(transactions).map((transaction) => ({
      ...timelineRecord(
        transaction,
        transaction.type === 'money_log' ? 'money_log' : 'transaction',
        transaction.completedAt || transaction.createdAt,
      ),
      originalType: transaction.type,
    })),
  ].filter(Boolean).sort((left, right) => timeOf(right).localeCompare(timeOf(left)));
}

function compactRelationships(friendships = [], playerUUID) {
  return asArray(friendships)
    .filter((friendship) => friendship?.UUID && friendship.players?.includes(playerUUID))
    .map((friendship) => ({
      UUID: friendship.UUID,
      players: asArray(friendship.players).filter(Boolean),
      requestedBy: friendship.requestedBy || null,
      status: friendship.status || 'pending',
      inGameTimestamp: number(friendship.inGameTimestamp),
      createdAt: friendship.createdAt || null,
      acceptedAt: friendship.acceptedAt || null,
    }))
    .sort((left, right) => timeOf(right).localeCompare(timeOf(left)))
    .slice(0, 64);
}

function acceptedFriendUUIDs(friendships = [], playerUUID) {
  const ids = new Set();
  for (const friendship of asArray(friendships)) {
    if (friendship?.status !== 'accepted' || !friendship.players?.includes(playerUUID)) continue;
    for (const UUID of friendship.players) {
      if (UUID && UUID !== playerUUID) ids.add(UUID);
    }
  }
  return [...ids].sort();
}

function ownedCosmeticIds(inventory = []) {
  return [...new Set([
    'minimalist',
    ...asArray(inventory).flatMap((item) => [item?.itemId, item?.type, item?.name?.toLowerCase()].filter(Boolean)),
  ])].sort();
}

function compactProfileView(profileView = null) {
  if (!profileView) return null;
  return {
    ...profileView,
    timelineEntries: asArray(profileView.timelineEntries).slice(0, PROFILE_SUMMARY_RECENT_LIMIT),
    eloSeries: asArray(profileView.eloSeries).slice(-PROFILE_SUMMARY_ELO_LIMIT),
    matchSummary: profileView.matchSummary ? {
      ...profileView.matchSummary,
      recent: asArray(profileView.matchSummary.recent).slice(0, PROFILE_SUMMARY_MATCH_LIMIT),
    } : null,
    highlightCards: asArray(profileView.highlightCards).slice(0, 6),
  };
}

export function buildProfileSummary({
  player,
  players = [],
  tasks = [],
  journals = [],
  events = [],
  transactions = [],
  matches = [],
  friendships = [],
  inventory = [],
  contributions = [],
  goals = [],
  updatedAt = new Date().toISOString(),
} = {}) {
  if (!player?.UUID) return null;
  const playerUUID = player.UUID;
  const history = buildHistory({
    tasks: asArray(tasks).filter((row) => row?.parent === playerUUID),
    journals: asArray(journals).filter((row) => row?.parent === playerUUID),
    events: asArray(events).filter((row) => row?.parent === playerUUID),
    transactions: asArray(transactions).filter((row) => row?.parent === playerUUID),
  });
  const playerMatches = asArray(matches)
    .filter((match) => match?.participants?.includes?.(playerUUID)
      || match?.participantUUIDs?.includes?.(playerUUID)
      || match?.participantSnapshot?.some?.((entry) => entry?.UUID === playerUUID)
      || match?.playerUUID === playerUUID)
    .sort((left, right) => timeOf(right).localeCompare(timeOf(left)));
  const playerContributions = asArray(contributions).filter((row) => row?.parent === playerUUID);
  const contributionTotal = getContributionTotal(playerContributions, playerUUID);
  const contributionDistribution = buildContributionByGoal(playerContributions, goals, playerUUID);
  const profileView = buildProfileViewModel({
    player,
    history,
    matches: playerMatches,
    allPlayers: players,
    currentPlayerUUID: playerUUID,
  });

  return withDerivedCacheMetadata({
    UUID: playerUUID,
    schemaVersion: PROFILE_SUMMARY_SCHEMA_VERSION,
    updatedAt,
    player: publicPlayerRecord(player),
    profileView: compactProfileView(profileView),
    recentTimelineEntries: history.slice(0, 5),
    recentMatches: playerMatches.slice(0, PROFILE_SUMMARY_MATCH_LIMIT),
    friendUUIDs: acceptedFriendUUIDs(friendships, playerUUID),
    relationships: compactRelationships(friendships, playerUUID),
    contributionTotal,
    contributionDistribution,
    ownedCosmeticIds: ownedCosmeticIds(
      asArray(inventory).filter((row) => row?.parent === playerUUID),
    ),
    sourceCounts: {
      tasks: history.filter((row) => row.type === 'task').length,
      journals: history.filter((row) => row.type === 'journal').length,
      events: history.filter((row) => row.type === 'event' || row.type === 'item_use').length,
      transactions: history.filter((row) => row.type === 'transaction' || row.type === 'money_log').length,
      matches: playerMatches.length,
      friends: acceptedFriendUUIDs(friendships, playerUUID).length,
    },
  }, {
    generatedAt: updatedAt,
    sourceVersions: sourceVersionsForRecordGroups({
      profiles: [player],
      tasks: asArray(tasks).filter((row) => row?.parent === playerUUID),
      journals: asArray(journals).filter((row) => row?.parent === playerUUID),
      dailyLifecycle: asArray(events).filter((row) => row?.parent === playerUUID),
      shop: asArray(transactions).filter((row) => row?.parent === playerUUID),
      matches: playerMatches,
      social: asArray(friendships).filter((row) => row?.players?.includes?.(playerUUID)),
      inventory: asArray(inventory).filter((row) => row?.parent === playerUUID),
      competitiveArenas: playerContributions,
      goals,
    }),
  });
}

export function buildProfileSummaries(records = {}, updatedAt = new Date().toISOString()) {
  const players = asArray(records.players);
  return players
    .map((player) => buildProfileSummary({
      player,
      players,
      tasks: records.tasks,
      journals: records.journals,
      events: records.events,
      transactions: records.transactions,
      matches: records.matches,
      friendships: records.friendships,
      inventory: records.inventory,
      contributions: records.contributions,
      goals: records.goals || records.projects,
      updatedAt,
    }))
    .filter(Boolean);
}

function summaryPlayerUUIDsForOperation(operation = {}) {
  const record = operation.record || operation.previousRecord || {};
  if (operation.store === STORES.player) return [record.UUID || operation.UUID].filter(Boolean);
  if (operation.store === STORES.friendship) return asArray(record.players).filter(Boolean);
  if (operation.store === STORES.match) {
    return [
      ...asArray(record.participants),
      ...asArray(record.participantUUIDs),
      ...asArray(record.participantSnapshot).map((entry) => entry?.UUID),
      record.playerUUID,
    ].filter(Boolean);
  }
  return [record.parent, record.authorUUID].filter(Boolean);
}

function upsertRecent(list = [], record, limit) {
  if (!record?.UUID) return asArray(list);
  return [record, ...asArray(list).filter((entry) => entry?.UUID !== record.UUID)]
    .sort((left, right) => timeOf(right).localeCompare(timeOf(left)))
    .slice(0, limit);
}

function removeRecent(list = [], UUID) {
  return asArray(list).filter((entry) => entry?.UUID !== UUID);
}

function countDelta(operation, predicate = () => true) {
  const before = operation.previousRecord && predicate(operation.previousRecord) ? 1 : 0;
  const after = operation.type === 'put' && predicate(operation.record) ? 1 : 0;
  return after - before;
}

function updateDirectPlayer(summary, operation) {
  if (operation.type !== 'put') return summary;
  return {
    ...summary,
    player: publicPlayerRecord(operation.record),
    profileView: summary.profileView ? {
      ...summary.profileView,
      summaryStats: asArray(summary.profileView.summaryStats).map((stat) => (
        stat.id === 'elo'
          ? { ...stat, value: Math.round(number(operation.record?.elo)).toLocaleString() }
          : stat.id === 'achievements'
            ? { ...stat, value: Object.keys(operation.record?.achievements || {}).length.toLocaleString() }
            : stat
      )),
    } : null,
  };
}

function updateTimelineSummary(summary, operation, type, predicate = () => true) {
  const UUID = operation.record?.UUID || operation.UUID;
  const previousVisible = operation.previousRecord && predicate(operation.previousRecord);
  const nextVisible = operation.type === 'put' && predicate(operation.record);
  let recentTimelineEntries = summary.recentTimelineEntries || [];
  let timelineEntries = summary.profileView?.timelineEntries || [];
  if (previousVisible || operation.type === 'delete') {
    recentTimelineEntries = removeRecent(recentTimelineEntries, UUID);
    timelineEntries = removeRecent(timelineEntries, UUID);
  }
  if (nextVisible) {
    const source = operation.record;
    const entry = type === 'event'
      ? { ...timelineRecord(source, source.type === 'item_use' ? 'item_use' : 'event'), originalType: source.type }
      : type === 'transaction'
        ? { ...timelineRecord(source, source.type === 'money_log' ? 'money_log' : 'transaction'), originalType: source.type }
        : timelineRecord(source, type);
    recentTimelineEntries = upsertRecent(recentTimelineEntries, entry, 5);
    timelineEntries = upsertRecent(timelineEntries, entry, PROFILE_SUMMARY_RECENT_LIMIT);
  }
  return {
    ...summary,
    recentTimelineEntries,
    profileView: summary.profileView ? { ...summary.profileView, timelineEntries } : summary.profileView,
  };
}

function updateSourceCount(summary, key, delta) {
  if (!delta) return summary;
  return {
    ...summary,
    sourceCounts: {
      ...(summary.sourceCounts || {}),
      [key]: Math.max(0, number(summary.sourceCounts?.[key]) + delta),
    },
  };
}

export function applyProfileSummaryOperations(existingSummaries = [], operations = [], now = new Date().toISOString()) {
  const summaries = new Map(asArray(existingSummaries).filter((row) => row?.UUID).map((row) => [row.UUID, row]));
  const touched = new Set();

  for (const operation of asArray(operations)) {
    if (!PROFILE_SUMMARY_SOURCE_STORES.has(operation?.store)) continue;
    const affectedPlayerUUIDs = operation.store === STORES.project
      ? [...summaries.keys()]
      : summaryPlayerUUIDsForOperation(operation);
    for (const playerUUID of affectedPlayerUUIDs) {
      let current = summaries.get(playerUUID);
      if (!current && operation.store === STORES.player && operation.type === 'put') {
        current = buildProfileSummary({
          player: operation.record,
          players: [
            ...summaries.values(),
          ].map((summary) => summary.player).filter(Boolean).concat(operation.record),
          updatedAt: now,
        });
        if (current) summaries.set(playerUUID, current);
      }
      if (!current) continue;
      if (operation.store === STORES.player && operation.type === 'delete') {
        summaries.delete(playerUUID);
        touched.add(playerUUID);
        continue;
      }
      let next = current;
      if (operation.store === STORES.player && current.UUID === playerUUID) {
        next = updateDirectPlayer(next, operation);
      } else if (operation.store === STORES.task) {
        next = updateTimelineSummary(next, operation, 'task', (record) => !!record?.completedAt);
        next = updateSourceCount(next, 'tasks', countDelta(operation, (record) => !!record?.completedAt));
      } else if (operation.store === STORES.journal) {
        next = updateTimelineSummary(next, operation, 'journal');
        next = updateSourceCount(next, 'journals', countDelta(operation));
      } else if (operation.store === STORES.event) {
        next = updateTimelineSummary(next, operation, 'event');
        next = updateSourceCount(next, 'events', countDelta(operation));
      } else if (operation.store === STORES.transaction) {
        next = updateTimelineSummary(next, operation, 'transaction');
        next = updateSourceCount(next, 'transactions', countDelta(operation));
      } else if (operation.store === STORES.match) {
        const UUID = operation.record?.UUID || operation.UUID;
        let recentMatches = removeRecent(next.recentMatches, UUID);
        if (operation.type === 'put') recentMatches = upsertRecent(recentMatches, operation.record, PROFILE_SUMMARY_MATCH_LIMIT);
        next = {
          ...next,
          recentMatches,
          profileView: next.profileView ? {
            ...next.profileView,
            matchSummary: next.profileView.matchSummary ? {
              ...next.profileView.matchSummary,
              recent: recentMatches.slice(0, 6),
            } : next.profileView.matchSummary,
          } : next.profileView,
        };
        next = updateSourceCount(next, 'matches', countDelta(operation));
      } else if (operation.store === STORES.friendship) {
        const record = operation.record || operation.previousRecord;
        const players = asArray(record?.players);
        const other = players.find((UUID) => UUID && UUID !== playerUUID);
        const friendUUIDs = new Set(asArray(next.friendUUIDs));
        if (operation.type === 'put' && operation.record?.status === 'accepted' && other) friendUUIDs.add(other);
        else if (other) friendUUIDs.delete(other);
        let relationships = removeRecent(next.relationships, record?.UUID || operation.UUID);
        if (operation.type === 'put') {
          relationships = upsertRecent(
            relationships,
            compactRelationships([operation.record], playerUUID)[0],
            64,
          );
        }
        next = {
          ...next,
          friendUUIDs: [...friendUUIDs].sort(),
          relationships,
          sourceCounts: { ...(next.sourceCounts || {}), friends: friendUUIDs.size },
        };
      } else if (operation.store === STORES.inventory) {
        const owned = new Set(asArray(next.ownedCosmeticIds));
        const record = operation.record || operation.previousRecord;
        const ids = [record?.itemId, record?.type, record?.name?.toLowerCase()].filter(Boolean);
        if (operation.type === 'put') ids.forEach((id) => owned.add(id));
        else ids.forEach((id) => owned.delete(id));
        next = { ...next, ownedCosmeticIds: [...owned].sort() };
      } else if (operation.store === STORES.contribution) {
        const before = operation.previousRecord?.parent === playerUUID ? number(operation.previousRecord.value) : 0;
        const after = operation.type === 'put' && operation.record?.parent === playerUUID ? number(operation.record.value) : 0;
        const source = operation.record || operation.previousRecord || {};
        const goalUUID = source.goalUUID || source.projectId || null;
        let contributionDistribution = asArray(next.contributionDistribution);
        if (goalUUID) {
          const existing = contributionDistribution.find((entry) => String(entry.goalUUID) === String(goalUUID));
          const value = Math.max(0, number(existing?.value) + after - before);
          contributionDistribution = [
            ...contributionDistribution.filter((entry) => String(entry.goalUUID) !== String(goalUUID)),
            ...(value > 0 ? [{
              goalUUID,
              name: operation.record?.goalNameSnapshot || existing?.name || 'Deleted Goal',
              value,
              color: existing?.color || '#4da3ff',
            }] : []),
          ].sort((left, right) => number(right.value) - number(left.value) || String(left.name).localeCompare(String(right.name)));
        }
        next = {
          ...next,
          contributionTotal: Math.max(0, number(next.contributionTotal) + after - before),
          contributionDistribution,
        };
      } else if (operation.store === STORES.project) {
        const goalUUID = operation.record?.UUID || operation.previousRecord?.UUID || operation.UUID;
        next = {
          ...next,
          contributionDistribution: asArray(next.contributionDistribution).map((entry) => (
            String(entry.goalUUID) === String(goalUUID)
              ? {
                ...entry,
                name: operation.type === 'put' ? operation.record?.name || entry.name : 'Deleted Goal',
                color: operation.type === 'put' ? operation.record?.accentColor || entry.color : entry.color,
              }
              : entry
          )),
        };
      }
      const sourceDomain = PROFILE_SUMMARY_SOURCE_DOMAIN_BY_STORE[operation.store];
      next = withDerivedCacheMetadata({ ...next, updatedAt: now }, {
        generatedAt: now,
        sourceVersions: sourceDomain
          ? bumpSourceVersion(next.cache?.sourceVersions, sourceDomain)
          : next.cache?.sourceVersions,
      });
      summaries.set(playerUUID, next);
      touched.add(playerUUID);
    }
  }

  return {
    summaries: [...summaries.values()],
    touched: [...touched],
  };
}

export function isCurrentProfileSummary(record) {
  return Number(record?.schemaVersion) === PROFILE_SUMMARY_SCHEMA_VERSION
    && !!record?.UUID
    && !!record?.player
    && isDerivedCacheMetadata(record?.cache);
}

export function isProfileSummarySourceStore(store) {
  return PROFILE_SUMMARY_SOURCE_STORES.has(store);
}
