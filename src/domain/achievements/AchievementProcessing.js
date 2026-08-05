import { SPECIAL_KIND, STORES } from '@domain/constants.js';
import {
  ACHIEVEMENT_THRESHOLDS,
  TOTAL_PAID_COSMETICS,
} from './Achievements.js';
import {
  processAchievementV2Event,
  replayAchievementV2Evidence,
} from '@domain/achievements-v2/AchievementV2Processor.js';

export const ACHIEVEMENT_PROCESSOR_VERSION = 2;
export const ACHIEVEMENT_COUNTER_VERSION = 1;

export const ACHIEVEMENT_EVENT_TYPE = Object.freeze({
  taskCompleted: 'task-completed',
  matchCompleted: 'match-completed',
  journalSaved: 'journal-saved',
  timelineEventCreated: 'timeline-event-created',
  eventLogged: 'event-logged',
  inventoryChanged: 'inventory-changed',
  economyLogged: 'economy-logged',
  socialChanged: 'social-changed',
  profileUpdated: 'profile-updated',
  milestoneCompleted: 'milestone-completed',
  goalCompleted: 'goal-completed',
  goalReviewed: 'goal-reviewed',
  retrospectiveAction: 'retrospective-action',
  semanticResponse: 'semantic-response',
  storyUpdated: 'story-updated',
  themeApplied: 'theme-applied',
  eraTransitioned: 'era-transitioned',
  projectEvidenceUpdated: 'project-evidence-updated',
  sharedHistoryUpdated: 'shared-history-updated',
});

export const ACHIEVEMENT_EVENT_GROUPS = Object.freeze({
  // v1 threshold families remain renderable in the Legacy Cabinet, but they
  // no longer issue new awards. v2 evaluates narrow evidence rules below.
  [ACHIEVEMENT_EVENT_TYPE.taskCompleted]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.matchCompleted]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.journalSaved]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.timelineEventCreated]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.eventLogged]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.inventoryChanged]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.economyLogged]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.socialChanged]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.profileUpdated]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.milestoneCompleted]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.goalCompleted]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.goalReviewed]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.retrospectiveAction]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.semanticResponse]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.storyUpdated]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.themeApplied]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.eraTransitioned]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.projectEvidenceUpdated]: Object.freeze([]),
  [ACHIEVEMENT_EVENT_TYPE.sharedHistoryUpdated]: Object.freeze([]),
});

const LEADERBOARD_GROUPS = new Set(['king_of_the_hill', 'peace', 'savant']);

const inFlightByConnection = new WeakMap();
const processingTailByConnection = new WeakMap();
const scheduledByConnection = new WeakMap();

function nowISO() {
  return new Date().toISOString();
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value) {
  return Math.max(0, finite(value));
}

function stableEventId(type, sourceUUID, parent) {
  return `achievement:${type}:${sourceUUID || parent || 'unknown'}`;
}

export function createAchievementEvent({
  UUID = null,
  type,
  parent,
  sourceUUID = null,
  occurredAt = null,
  payload = {},
} = {}) {
  if (!type || !parent) throw new Error('Achievement events require type and parent.');
  const timestamp = occurredAt || nowISO();
  return Object.freeze({
    UUID: UUID || stableEventId(type, sourceUUID, parent),
    parent,
    type,
    sourceUUID: sourceUUID || null,
    eventSchemaVersion: 1,
    createdAt: timestamp,
    occurredAt: timestamp,
    payload: { ...payload },
  });
}

function emptyCounters(player = {}) {
  return {
    completedTasks: 0,
    lifetimeTaskPoints: 0,
    maxTaskDurationHours: 0,
    taskDays: {},
    bestTasksInDay: 0,
    longestTaskDayStreak: 0,
    timelineEntries: 0,
    maxJournalWords: 0,
    ownedCosmetics: 0,
    completedMatches: 0,
    currentWinStreak: 0,
    bestWinningMargin: null,
    largestWinningMargin: 0,
    bestEloGain: 0,
    currentElo: finite(player.elo),
    eventLogs: 0,
    fellowshipContribution: 0,
    economyLoggedTotal: 0,
    profileSignatureScore: 0,
    acceptedFriends: 0,
    bestDojoSessionPoints: 0,
    dojoSessionPointsByDay: {},
  };
}

function normalizeState(record, player) {
  return {
    UUID: record?.UUID || `achievement-state:${player.UUID}`,
    parent: player.UUID,
    counterVersion: ACHIEVEMENT_COUNTER_VERSION,
    counters: { ...emptyCounters(player), ...(record?.counters || {}) },
    appliedEvents: { ...(record?.appliedEvents || {}) },
    eventAwards: { ...(record?.eventAwards || {}) },
    needsReconciliation: record?.needsReconciliation !== false,
    createdAt: record?.createdAt || nowISO(),
    updatedAt: record?.updatedAt || nowISO(),
  };
}

function longestConsecutiveDayRun(dayCounts = {}) {
  const days = Object.keys(dayCounts).filter((day) => finite(dayCounts[day]) > 0).sort();
  let longest = 0;
  let current = 0;
  let previous = null;
  for (const day of days) {
    const timestamp = new Date(`${day}T00:00:00`).getTime();
    if (!Number.isFinite(timestamp)) continue;
    current = previous != null && timestamp - previous === 86400000 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = timestamp;
  }
  return longest;
}

function applyEventToCounters(counters, event) {
  const next = {
    ...counters,
    taskDays: { ...(counters.taskDays || {}) },
    dojoSessionPointsByDay: { ...(counters.dojoSessionPointsByDay || {}) },
  };
  const payload = event.payload || {};

  switch (event.type) {
    case ACHIEVEMENT_EVENT_TYPE.taskCompleted: {
      const day = String(payload.completedAt || event.occurredAt || '').split('T')[0];
      next.completedTasks = finite(next.completedTasks) + 1;
      next.lifetimeTaskPoints = finite(next.lifetimeTaskPoints) + finite(payload.points);
      next.timelineEntries = finite(next.timelineEntries) + 1;
      next.maxTaskDurationHours = Math.max(
        finite(next.maxTaskDurationHours),
        positive(payload.durationMs) / 3600000,
      );
      if (day) {
        next.taskDays[day] = finite(next.taskDays[day]) + 1;
        next.bestTasksInDay = Math.max(finite(next.bestTasksInDay), next.taskDays[day]);
        next.longestTaskDayStreak = longestConsecutiveDayRun(next.taskDays);
        if (payload.source === 'dojo') {
          next.dojoSessionPointsByDay[day] = finite(next.dojoSessionPointsByDay[day]) + finite(payload.points);
          next.bestDojoSessionPoints = Math.max(
            finite(next.bestDojoSessionPoints),
            next.dojoSessionPointsByDay[day],
          );
        }
      }
      break;
    }
    case ACHIEVEMENT_EVENT_TYPE.matchCompleted: {
      next.completedMatches = finite(next.completedMatches) + 1;
      next.currentWinStreak = payload.won ? finite(next.currentWinStreak) + 1 : 0;
      if (payload.won) {
        const margin = Math.abs(finite(payload.scoreMargin));
        next.bestWinningMargin = next.bestWinningMargin == null
          ? margin
          : Math.min(finite(next.bestWinningMargin, margin), margin);
        next.largestWinningMargin = Math.max(finite(next.largestWinningMargin), margin);
      }
      next.bestEloGain = Math.max(finite(next.bestEloGain), finite(payload.eloChange));
      next.currentElo = finite(payload.newElo, next.currentElo);
      break;
    }
    case ACHIEVEMENT_EVENT_TYPE.journalSaved:
      if (payload.isNew !== false) next.timelineEntries = finite(next.timelineEntries) + 1;
      next.maxJournalWords = Math.max(finite(next.maxJournalWords), finite(payload.wordCount));
      break;
    case ACHIEVEMENT_EVENT_TYPE.timelineEventCreated:
      if (payload.isNew !== false) next.timelineEntries = finite(next.timelineEntries) + 1;
      break;
    case ACHIEVEMENT_EVENT_TYPE.eventLogged:
      next.eventLogs = finite(next.eventLogs) + (payload.isNew === false ? 0 : 1);
      next.fellowshipContribution = finite(next.fellowshipContribution)
        + positive(payload.fellowshipContribution);
      break;
    case ACHIEVEMENT_EVENT_TYPE.inventoryChanged:
      next.ownedCosmetics = Math.max(0, finite(payload.ownedCosmetics, next.ownedCosmetics));
      break;
    case ACHIEVEMENT_EVENT_TYPE.economyLogged:
      next.economyLoggedTotal = finite(next.economyLoggedTotal) + positive(payload.amount);
      break;
    case ACHIEVEMENT_EVENT_TYPE.socialChanged:
      next.acceptedFriends = Math.max(0, payload.acceptedFriendDelta == null
        ? finite(payload.acceptedFriends, next.acceptedFriends)
        : finite(next.acceptedFriends) + finite(payload.acceptedFriendDelta));
      break;
    case ACHIEVEMENT_EVENT_TYPE.profileUpdated:
      next.profileSignatureScore = Math.max(0, finite(payload.signatureScore, next.profileSignatureScore));
      next.currentElo = finite(payload.elo, next.currentElo);
      break;
    default:
      break;
  }
  return next;
}

function grant(achievements, earned, key, event) {
  if (achievements[key]) return;
  achievements[key] = {
    earnedAt: event.occurredAt || nowISO(),
    sourceEventUUID: event.UUID,
  };
  earned.push(key);
}

function grantTiered(achievements, earned, group, value, event, predicate = (current, threshold) => current >= threshold) {
  for (const [index, threshold] of (ACHIEVEMENT_THRESHOLDS[group] || []).entries()) {
    if (predicate(value, threshold)) grant(achievements, earned, `${group}_${index + 1}`, event);
  }
}

function evaluateGroups({ player, counters, event, groups, leaderboard }) {
  const achievements = { ...(player.achievements || {}) };
  const earned = [];
  const payload = event.payload || {};
  const selectedAchievements = [...(player.selectedAchievements || [])];

  for (const group of groups) {
    switch (group) {
      case 'grinder':
        grantTiered(achievements, earned, group, counters.completedTasks, event);
        break;
      case 'scorer':
        grantTiered(achievements, earned, group, counters.lifetimeTaskPoints, event);
        break;
      case 'deep_work':
        grantTiered(achievements, earned, group, counters.maxTaskDurationHours, event);
        break;
      case 'consistency':
        grantTiered(achievements, earned, group, counters.longestTaskDayStreak, event);
        break;
      case 'scholar':
        grantTiered(achievements, earned, group, counters.bestTasksInDay, event);
        break;
      case 'basket':
        grantTiered(achievements, earned, group, counters.timelineEntries, event);
        break;
      case 'legacy':
        grantTiered(achievements, earned, group, counters.maxJournalWords, event);
        break;
      case 'hobbyist':
        grantTiered(achievements, earned, group, counters.ownedCosmetics, event);
        break;
      case 'event_runner':
        grantTiered(achievements, earned, group, counters.eventLogs, event);
        break;
      case 'fellowship':
        grantTiered(achievements, earned, group, counters.fellowshipContribution, event);
        break;
      case 'treasurer':
        grantTiered(achievements, earned, group, counters.economyLoggedTotal, event);
        break;
      case 'signature':
        grantTiered(achievements, earned, group, counters.profileSignatureScore, event);
        break;
      case 'town':
        grantTiered(achievements, earned, group, counters.acceptedFriends, event);
        break;
      case 'long_game':
        grantTiered(achievements, earned, group, counters.completedMatches, event);
        break;
      case 'soldier':
        grantTiered(achievements, earned, group, counters.currentWinStreak, event);
        break;
      case 'climber':
        grantTiered(achievements, earned, group, counters.currentElo, event);
        break;
      case 'momentum':
        grantTiered(achievements, earned, group, counters.bestEloGain, event);
        break;
      case 'clutch':
        if (payload.won || event.type !== ACHIEVEMENT_EVENT_TYPE.matchCompleted) {
          const margin = counters.bestWinningMargin == null ? Infinity : counters.bestWinningMargin;
          grantTiered(achievements, earned, group, margin, event, (value, threshold) => value <= threshold);
        }
        break;
      case 'overkill':
        if (payload.won) {
          grantTiered(achievements, earned, group, Math.abs(finite(payload.scoreMargin)), event, (value, threshold) => value > threshold);
        }
        break;
      case 'underdog':
        if (payload.won) grantTiered(achievements, earned, group, finite(payload.opponentRankAdvantage), event);
        break;
      case 'contributor':
        if (payload.won) grantTiered(achievements, earned, group, finite(payload.teamContributionRatio), event);
        break;
      case 'king_of_the_hill': {
        if (leaderboard.isTopPoints) {
          grant(achievements, earned, 'king_of_the_hill_1', event);
          grant(achievements, earned, 'king_of_the_hill_2', event);
        } else {
          delete achievements.king_of_the_hill_2;
        }
        break;
      }
      case 'peace': {
        if (leaderboard.isTopTenDojo) grant(achievements, earned, 'peace_1', event);
        if (leaderboard.isTopDojo) {
          grant(achievements, earned, 'peace_2', event);
          grant(achievements, earned, 'peace_3', event);
        } else {
          delete achievements.peace_3;
        }
        break;
      }
      case 'savant':
        if (
          counters.currentElo >= 3000
          && leaderboard.isTopPoints
          && counters.ownedCosmetics >= TOTAL_PAID_COSMETICS
        ) grant(achievements, earned, 'savant_1', event);
        break;
      default:
        break;
    }
  }

  const removed = Object.keys(player.achievements || {}).filter((key) => !achievements[key]);
  if (removed.length) {
    for (let index = 0; index < selectedAchievements.length; index += 1) {
      if (removed.includes(selectedAchievements[index])) selectedAchievements[index] = null;
    }
  }
  return { achievements, selectedAchievements, earned, removed };
}

function leaderboardFor(states, playerUUID) {
  const points = [...states]
    .map((state) => ({ parent: state.parent, value: finite(state.counters?.lifetimeTaskPoints) }))
    .sort((left, right) => right.value - left.value || String(left.parent).localeCompare(String(right.parent)));
  const topPoints = points.length > 1 ? points[0]?.value : null;
  const myPoints = points.find((entry) => entry.parent === playerUUID)?.value;
  const dojo = [...states]
    .flatMap((state) => Object.entries(state.counters?.dojoSessionPointsByDay || {})
      .map(([day, value]) => ({ parent: state.parent, day, value: finite(value) })))
    .filter((entry) => entry.value > 0)
    .sort((left, right) => (
      right.value - left.value
      || String(left.day).localeCompare(String(right.day))
      || String(left.parent).localeCompare(String(right.parent))
    ));
  return {
    isTopPoints: topPoints != null && myPoints >= topPoints,
    isTopDojo: dojo[0]?.parent === playerUUID,
    isTopTenDojo: dojo.slice(0, 10).some((entry) => entry.parent === playerUUID),
  };
}

function connectionMap(registry, databaseConnection) {
  let map = registry.get(databaseConnection);
  if (!map) {
    map = new Map();
    registry.set(databaseConnection, map);
  }
  return map;
}

function scheduleAchievementOperation(databaseConnection, event, run) {
  const inFlight = connectionMap(inFlightByConnection, databaseConnection);
  if (inFlight.has(event.UUID)) return inFlight.get(event.UUID);

  const tails = connectionMap(processingTailByConnection, databaseConnection);
  const previous = tails.get(event.parent) || Promise.resolve();
  let operation;
  operation = previous
    .catch(() => undefined)
    .then(run)
    .finally(() => {
      if (inFlight.get(event.UUID) === operation) inFlight.delete(event.UUID);
      if (tails.get(event.parent) === operation) tails.delete(event.parent);
    });
  inFlight.set(event.UUID, operation);
  tails.set(event.parent, operation);
  return operation;
}

async function markRewardIssued(databaseConnection, receipt, issuedKeys) {
  const updated = {
    ...receipt,
    issuedKeys: [...issuedKeys],
    rewardIssuedAt: receipt.rewardIssuedAt || nowISO(),
    updatedAt: nowISO(),
  };
  await databaseConnection.add(STORES.achievementReceipt, updated);
  return updated;
}

function emitAchievementRewards(keys, context = {}) {
  if (!keys.length) return;
  try {
    context.onEarned?.(keys);
  } catch (error) {
    console.warn('[AchievementProcessing] reward callback failed:', error);
  }
  // Achievement processing also runs from background recovery and cloud-sync
  // passes, where there may be no feature-level callback. Publish one canonical
  // UI event so every newly issued award receives the same visible celebration.
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('tapestry:achievement-earned', {
      detail: { keys: [...keys] },
    }));
  }
}

export async function processAchievementEvent(databaseConnection, eventOrId, context = {}) {
  if (!databaseConnection || !eventOrId) return { earned: [], status: 'ignored' };
  const event = typeof eventOrId === 'string'
    ? await databaseConnection.get(STORES.achievementEvent, eventOrId)
    : eventOrId;
  if (!event?.UUID || !event.parent || !ACHIEVEMENT_EVENT_GROUPS[event.type]) {
    return { earned: [], status: 'ignored' };
  }

  return scheduleAchievementOperation(databaseConnection, event, async () => {
    const receiptId = `achievement-receipt:${event.UUID}`;
    let receipt = await databaseConnection.get(STORES.achievementReceipt, receiptId).catch(() => null);
    const requiresV2Evaluation = Number(receipt?.processorVersion || 0) < ACHIEVEMENT_PROCESSOR_VERSION;
    if (receipt?.status === 'completed' && !requiresV2Evaluation) {
      if (!receipt.rewardIssuedAt && Array.isArray(receipt.earnedKeys) && receipt.earnedKeys.length) {
        receipt = await markRewardIssued(databaseConnection, receipt, receipt.earnedKeys);
        emitAchievementRewards(receipt.earnedKeys, context);
      }
      return { earned: receipt.earnedKeys || [], status: 'already-completed' };
    }

    const player = await databaseConnection.get(STORES.player, event.parent);
    if (!player) throw new Error(`Achievement event ${event.UUID} has no player ${event.parent}.`);
    const stateId = `achievement-state:${event.parent}`;
    const storedState = await databaseConnection.get(STORES.achievementState, stateId).catch(() => null);
    let state = normalizeState(storedState, player);
    const alreadyApplied = !!state.appliedEvents[event.UUID];
    if (!alreadyApplied) {
      state = {
        ...state,
        counters: applyEventToCounters(state.counters, event),
        appliedEvents: { ...state.appliedEvents, [event.UUID]: nowISO() },
        updatedAt: nowISO(),
      };
    }

    const groups = ACHIEVEMENT_EVENT_GROUPS[event.type];
    const allStoredStates = groups.some((group) => LEADERBOARD_GROUPS.has(group))
      ? await databaseConnection.getAll(STORES.achievementState).catch(() => [])
      : [];
    const states = allStoredStates.filter((entry) => entry?.parent !== event.parent);
    states.push(state);
    const evaluation = evaluateGroups({
      player,
      counters: state.counters,
      event,
      groups,
      leaderboard: leaderboardFor(states, event.parent),
    });
    const persistedAwards = state.eventAwards[event.UUID];
    const v2Result = alreadyApplied && Array.isArray(persistedAwards) && !requiresV2Evaluation
      ? { earned: persistedAwards }
      : await processAchievementV2Event(databaseConnection, event);
    const earnedKeys = requiresV2Evaluation
      ? v2Result.earned
      : (Array.isArray(persistedAwards) ? persistedAwards : v2Result.earned);
    state = {
      ...state,
      eventAwards: { ...state.eventAwards, [event.UUID]: earnedKeys },
      updatedAt: nowISO(),
    };
    await databaseConnection.add(STORES.achievementState, state);

    const playerChanged = JSON.stringify(evaluation.achievements) !== JSON.stringify(player.achievements || {})
      || JSON.stringify(evaluation.selectedAchievements) !== JSON.stringify(player.selectedAchievements || []);
    if (playerChanged) {
      await databaseConnection.add(STORES.player, {
        ...player,
        achievements: evaluation.achievements,
        selectedAchievements: evaluation.selectedAchievements,
      });
    }

    receipt = {
      UUID: receiptId,
      parent: event.parent,
      eventUUID: event.UUID,
      eventType: event.type,
      processorVersion: ACHIEVEMENT_PROCESSOR_VERSION,
      status: 'completed',
      earnedKeys,
      removedKeys: evaluation.removed,
      createdAt: receipt?.createdAt || nowISO(),
      completedAt: nowISO(),
      updatedAt: nowISO(),
      rewardIssuedAt: null,
      issuedKeys: [],
    };
    await databaseConnection.add(STORES.achievementReceipt, receipt);
    if (earnedKeys.length) {
      receipt = await markRewardIssued(databaseConnection, receipt, earnedKeys);
      emitAchievementRewards(earnedKeys, context);
    }
    return { earned: earnedKeys, removed: evaluation.removed, status: 'completed' };
  });
}

function scheduleIdle(callback) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    return { kind: 'idle', id: window.requestIdleCallback(callback, { timeout: 1500 }) };
  }
  if (typeof setTimeout === 'function') return { kind: 'timeout', id: setTimeout(callback, 0) };
  Promise.resolve().then(callback);
  return { kind: 'promise', id: null };
}

export async function recordAchievementEvent(databaseConnection, eventInput) {
  if (!databaseConnection || !eventInput) return null;
  const event = eventInput.UUID ? eventInput : createAchievementEvent(eventInput);
  const existing = await databaseConnection.get(STORES.achievementEvent, event.UUID).catch(() => null);
  if (!existing) await databaseConnection.add(STORES.achievementEvent, event);
  return existing || event;
}

export async function queueAchievementEvent(databaseConnection, eventInput, context = {}) {
  const event = await recordAchievementEvent(databaseConnection, eventInput);
  if (!event) return null;

  let scheduled = scheduledByConnection.get(databaseConnection);
  if (!scheduled) {
    scheduled = new Map();
    scheduledByConnection.set(databaseConnection, scheduled);
  }
  if (!scheduled.has(event.UUID)) {
    const handle = scheduleIdle(() => {
      scheduled.delete(event.UUID);
      processAchievementEvent(databaseConnection, event.UUID, context)
        .catch((error) => console.warn('[AchievementProcessing] deferred event failed:', error));
    });
    scheduled.set(event.UUID, handle);
  }
  return event;
}

export async function recoverPendingAchievementEvents(databaseConnection, context = {}) {
  if (!databaseConnection) return [];
  const events = await databaseConnection.getAll(STORES.achievementEvent);
  const ordered = [...events].sort((left, right) => (
    String(left.occurredAt || left.createdAt || '').localeCompare(String(right.occurredAt || right.createdAt || ''))
    || String(left.UUID).localeCompare(String(right.UUID))
  ));
  const results = [];
  for (const event of ordered) {
    // Sequential replay prevents concurrent counter updates for one player.
    // eslint-disable-next-line no-await-in-loop
    results.push(await processAchievementEvent(databaseConnection, event, context));
  }
  return results;
}

export function buildAchievementCountersFromRecords(player, data = {}) {
  const tasks = (data.tasks || []).filter((task) => task?.parent === player.UUID && task.completedAt);
  const journals = (data.journals || []).filter((entry) => entry?.parent === player.UUID);
  const events = (data.events || []).filter((entry) => entry?.parent === player.UUID);
  const matches = (data.matches || []).filter((match) => match?.status === 'complete' && match.result);
  const eventLogs = (data.eventLogs || []).filter((entry) => entry?.parent === player.UUID);
  const transactions = (data.transactions || []).filter((entry) => entry?.parent === player.UUID);
  const taskDays = {};
  const dojoSessionPointsByDay = {};
  let maxTaskDurationHours = 0;
  let lifetimeTaskPoints = 0;
  for (const task of tasks) {
    lifetimeTaskPoints += finite(task.points);
    const day = String(task.completedAt || '').split('T')[0];
    if (day) taskDays[day] = finite(taskDays[day]) + 1;
    if (task.source === 'dojo' && day) {
      dojoSessionPointsByDay[day] = finite(dojoSessionPointsByDay[day]) + finite(task.points);
    }
    const durationMs = task.sessionDuration
      || (new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime());
    maxTaskDurationHours = Math.max(maxTaskDurationHours, positive(durationMs) / 3600000);
  }
  const sortedMatches = [...matches].sort((left, right) => String(
    right.result?.concludedAt || right.createdAt || '',
  ).localeCompare(String(left.result?.concludedAt || left.createdAt || '')));
  let currentWinStreak = 0;
  for (const match of sortedMatches) {
    const team1 = match.teams?.[0] || [];
    const onTeam1 = team1.some((candidate) => String(candidate.UUID) === String(player.UUID));
    const won = (match.result.winner === 1 && onTeam1) || (match.result.winner === 2 && !onTeam1);
    if (!won) break;
    currentWinStreak += 1;
  }
  const winningMargins = matches.map((match) => {
    const team1 = match.teams?.[0] || [];
    const onTeam1 = team1.some((candidate) => String(candidate.UUID) === String(player.UUID));
    const won = (match.result.winner === 1 && onTeam1) || (match.result.winner === 2 && !onTeam1);
    return won ? Math.abs(finite(match.result.team1Total) - finite(match.result.team2Total)) : null;
  }).filter((value) => value != null);
  const counters = emptyCounters(player);
  return {
    ...counters,
    completedTasks: tasks.length,
    lifetimeTaskPoints,
    maxTaskDurationHours,
    taskDays,
    bestTasksInDay: Math.max(0, ...Object.values(taskDays)),
    longestTaskDayStreak: longestConsecutiveDayRun(taskDays),
    timelineEntries: tasks.length + journals.length + events.length,
    maxJournalWords: Math.max(0, ...journals.map((entry) => achievementWordCount(entry.entry))),
    ownedCosmetics: ownedCosmeticCount(data.inventory || []),
    completedMatches: matches.length,
    currentWinStreak,
    bestWinningMargin: winningMargins.length ? Math.min(...winningMargins) : null,
    largestWinningMargin: Math.max(0, ...winningMargins),
    bestEloGain: Math.max(0, ...matches.map((match) => finite(match.result?.eloChange))),
    currentElo: finite(player.elo),
    eventLogs: eventLogs.length,
    fellowshipContribution: eventLogs
      .filter((entry) => entry.specialKind === SPECIAL_KIND.sleep_time && entry.status === 'success')
      .length,
    economyLoggedTotal: transactions
      .filter((entry) => entry.type === 'money_log')
      .reduce((sum, entry) => sum + positive(entry.amount ?? entry.cost), 0),
    profileSignatureScore: profileSignatureScore(player),
    acceptedFriends: (data.friends || []).filter((entry) => entry.status === 'accepted').length,
    bestDojoSessionPoints: Math.max(0, ...Object.values(dojoSessionPointsByDay)),
    dojoSessionPointsByDay,
  };
}

export async function reconcileAchievementState(databaseConnection, player, {
  reason,
  data = null,
} = {}) {
  const allowedReasons = new Set(['migration', 'repair', 'explicit-reconciliation', 'development-verification']);
  if (!allowedReasons.has(reason)) {
    throw new Error('Achievement counter reconciliation requires an explicit allowed reason.');
  }
  const records = data || {
    tasks: await databaseConnection.getAll(STORES.task),
    journals: await databaseConnection.getAll(STORES.journal),
    events: await databaseConnection.getAll(STORES.event),
    matches: await databaseConnection.getMatchesForPlayer(player.UUID),
    inventory: await databaseConnection.getPlayerStore(STORES.inventory, player.UUID),
    friends: await databaseConnection.getFriendshipsForPlayer(player.UUID),
    transactions: await databaseConnection.getAll(STORES.transaction),
    eventLogs: await databaseConnection.getAll(STORES.eventLog),
    allPlayers: await databaseConnection.getAllPlayers(),
  };
  const existing = await databaseConnection.get(
    STORES.achievementState,
    `achievement-state:${player.UUID}`,
  ).catch(() => null);
  const state = {
    ...normalizeState(existing, player),
    counters: buildAchievementCountersFromRecords(player, records),
    needsReconciliation: false,
    reconciledAt: nowISO(),
    reconciliationReason: reason,
    updatedAt: nowISO(),
  };
  await databaseConnection.add(STORES.achievementState, state);
  const replay = await replayAchievementV2Evidence(
    databaseConnection,
    player.UUID,
    await databaseConnection.getAll(STORES.achievementEvent),
  );
  return { state, earned: replay.earned, replayed: replay.replayed };
}

export function achievementWordCount(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

export function profileSignatureScore(player = {}) {
  const prefs = player.profilePersonalization || {};
  const links = Array.isArray(prefs.links) ? prefs.links : (Array.isArray(prefs.socialLinks) ? prefs.socialLinks : []);
  return [
    prefs.tagline,
    prefs.about || prefs.aboutMarkdown,
    prefs.quote,
    links.some((link) => link?.label || link?.url),
    player.activeCosmetics?.profileBanner,
    prefs.skin && prefs.skin !== 'arena',
    player.activeCosmetics?.title,
  ].filter(Boolean).length;
}

export function ownedCosmeticCount(inventory = []) {
  const cosmeticTypes = new Set([
    'cosmetic_theme', 'cosmetic_title', 'cosmetic_card_banner',
    'cosmetic_profile_banner', 'cosmetic_lobby_banner', 'cosmetic_profile_block',
  ]);
  return new Set(inventory
    .filter((item) => cosmeticTypes.has(item?.type))
    .map((item) => item.itemId || item.name)
    .filter(Boolean)).size;
}
