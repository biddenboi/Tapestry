import { SPECIAL_EVENT_IDS, STORES } from '@domain/constants.js';
import {
  ACHIEVEMENT_EVENT_TYPE,
  createAchievementEvent,
  processAchievementEvent,
  recordAchievementEvent,
} from '@domain/achievements/AchievementProcessing.js';
import { clearDojoMultiplier } from '@domain/events/Events.js';
import { LEADERBOARD_REBUILD_SCOPE, queueMaterializedLeaderboardRebuild } from '@domain/leaderboards/MaterializedLeaderboards.js';
import { computeEloChanges } from '@domain/matches/Elo.js';
import { buildMatchHighlights } from '@domain/matches/MatchHighlights.js';
import { getMatchTeams } from '@domain/matches/MatchContracts.js';
import { MATCH_POST_PROCESSING_VERSION } from '@domain/matches/MatchCompletionService.js';
import { getRankGroupFloor, getRankGroupIndex } from '@domain/rank/Rank.js';
import {
  BACKGROUND_JOB_PRIORITY,
  BackgroundJobScheduler,
} from '@shared/background-jobs/BackgroundJobScheduler.js';

export const MATCH_JOB_SCHEMA_VERSION = 1;

export const MATCH_JOB_TYPE = Object.freeze({
  elo: 'match-elo',
  leaderboard: 'match-leaderboard',
  achievements: 'match-achievements',
  contribution: 'match-contribution',
  narration: 'match-narration',
  cache: 'match-cache',
  dojoEffects: 'match-dojo-effects',
});

const JOB_SPECS = Object.freeze([
  Object.freeze({ type: MATCH_JOB_TYPE.elo, priority: BACKGROUND_JOB_PRIORITY.critical, maxAttempts: 3, execution: 'main' }),
  Object.freeze({ type: MATCH_JOB_TYPE.leaderboard, priority: BACKGROUND_JOB_PRIORITY.high, maxAttempts: 3, execution: 'main' }),
  Object.freeze({ type: MATCH_JOB_TYPE.achievements, priority: BACKGROUND_JOB_PRIORITY.normal + 10, maxAttempts: 3, execution: 'main' }),
  Object.freeze({ type: MATCH_JOB_TYPE.contribution, priority: BACKGROUND_JOB_PRIORITY.normal + 5, maxAttempts: 3, execution: 'main' }),
  Object.freeze({ type: MATCH_JOB_TYPE.dojoEffects, priority: BACKGROUND_JOB_PRIORITY.normal, maxAttempts: 3, execution: 'main' }),
  Object.freeze({ type: MATCH_JOB_TYPE.narration, priority: BACKGROUND_JOB_PRIORITY.normal - 5, maxAttempts: 2, execution: 'worker' }),
  Object.freeze({ type: MATCH_JOB_TYPE.cache, priority: BACKGROUND_JOB_PRIORITY.idle, maxAttempts: 2, execution: 'main' }),
]);

const schedulerStateByConnection = new WeakMap();
const matchMutationLocks = new WeakMap();

function nowISO() {
  return new Date().toISOString();
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function postMatchJobUUID(matchUUID, type) {
  return `post-match:${matchUUID}:${type}`;
}

export function postMatchReceiptUUID(matchUUID, type) {
  return `post-match-receipt:${matchUUID}:${type}`;
}

function withMatchMutationLock(databaseConnection, matchUUID, operation) {
  let locks = matchMutationLocks.get(databaseConnection);
  if (!locks) {
    locks = new Map();
    matchMutationLocks.set(databaseConnection, locks);
  }
  const previous = locks.get(matchUUID) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  locks.set(matchUUID, next);
  return next.finally(() => {
    if (locks.get(matchUUID) === next) locks.delete(matchUUID);
  });
}

async function updatePersistedJob(databaseConnection, record, patch) {
  const current = await databaseConnection.get(STORES.backgroundJob, record.UUID).catch(() => null);
  const next = {
    ...(current || record),
    ...patch,
    updatedAt: nowISO(),
  };
  await databaseConnection.add(STORES.backgroundJob, next);
  return next;
}

async function writeReceipt(databaseConnection, record, status, result = null, error = null) {
  const UUID = postMatchReceiptUUID(record.matchUUID, record.type);
  const previous = await databaseConnection.get(STORES.backgroundJobReceipt, UUID).catch(() => null);
  const next = {
    UUID,
    parent: record.parent,
    matchUUID: record.matchUUID,
    jobUUID: record.UUID,
    type: record.type,
    processorVersion: MATCH_JOB_SCHEMA_VERSION,
    status,
    attempts: Math.max(Number(previous?.attempts) || 0, Number(record.attempts) || 0),
    createdAt: previous?.createdAt || nowISO(),
    updatedAt: nowISO(),
    completedAt: status === 'completed' ? nowISO() : null,
    result: result == null ? null : result,
    error: error ? String(error?.message || error) : null,
  };
  await databaseConnection.add(STORES.backgroundJobReceipt, next);
  return next;
}

async function runPersistedJob(databaseConnection, payload, schedulerContext, operation) {
  const { jobRecord } = payload;
  const receiptId = postMatchReceiptUUID(jobRecord.matchUUID, jobRecord.type);
  const existingReceipt = await databaseConnection.get(STORES.backgroundJobReceipt, receiptId).catch(() => null);
  if (existingReceipt?.status === 'completed') return existingReceipt.result;

  const runningRecord = await updatePersistedJob(databaseConnection, jobRecord, {
    state: 'running',
    attempts: schedulerContext.job.attempts,
    startedAt: schedulerContext.job.startedAt || nowISO(),
    error: null,
  });
  try {
    const result = await operation(runningRecord, schedulerContext);
    await databaseConnection.commitAtomicMutation({
      label: 'post-match-job-complete',
      puts: [
        {
          store: STORES.backgroundJob,
          record: {
            ...runningRecord,
            state: 'completed',
            completedAt: nowISO(),
            updatedAt: nowISO(),
            error: null,
          },
        },
        {
          store: STORES.backgroundJobReceipt,
          record: {
            UUID: receiptId,
            parent: runningRecord.parent,
            matchUUID: runningRecord.matchUUID,
            jobUUID: runningRecord.UUID,
            type: runningRecord.type,
            processorVersion: MATCH_JOB_SCHEMA_VERSION,
            status: 'completed',
            attempts: schedulerContext.job.attempts,
            createdAt: existingReceipt?.createdAt || nowISO(),
            updatedAt: nowISO(),
            completedAt: nowISO(),
            result: result == null ? null : result,
            error: null,
          },
        },
      ],
      flush: false,
      queueDerived: false,
    });
    return result;
  } catch (error) {
    const cancelled = schedulerContext.signal?.aborted || error?.name === 'AbortError';
    const terminalStatus = cancelled ? 'cancelled' : 'failed';
    await updatePersistedJob(databaseConnection, runningRecord, {
      state: terminalStatus,
      attempts: schedulerContext.job.attempts,
      completedAt: cancelled ? nowISO() : null,
      error: String(error?.message || error),
    }).catch(() => undefined);
    await writeReceipt(databaseConnection, runningRecord, terminalStatus, null, error).catch(() => undefined);
    throw error;
  }
}

export function buildSnapshotEloChanges(match) {
  const teams = getMatchTeams(match);
  const raw = computeEloChanges(
    teams,
    match?.result?.playerScores || {},
    match?.result?.eloInput?.forcedLoserTeamIdx ?? null,
  );
  const changes = {};
  for (const participant of teams.flat()) {
    const UUID = String(participant?.UUID || '');
    if (!UUID) continue;
    const oldElo = Math.max(0, finite(participant.elo));
    const rawChange = raw.changes[UUID] || { change: 0, breakdown: [] };
    const newElo = Math.max(getRankGroupFloor(oldElo), oldElo + finite(rawChange.change));
    changes[UUID] = {
      oldElo,
      newElo,
      change: newElo - oldElo,
      breakdown: rawChange.breakdown || [],
      isWinner: !!rawChange.isWinner,
    };
  }
  return { ...raw, changes };
}

async function processElo(databaseConnection, matchUUID) {
  return withMatchMutationLock(databaseConnection, matchUUID, async () => {
    const match = await databaseConnection.get(STORES.match, matchUUID);
    if (!match?.result) return { updated: false };
    if (match.result.playerEloChangesVersion === 1) return { updated: false, alreadyApplied: true };
    await databaseConnection.ensureDomainLoaded?.('profiles');
    const calculated = buildSnapshotEloChanges(match);
    const ownerChange = calculated.changes[String(match.parent)] || null;
    const playerPuts = [];
    for (const [UUID, change] of Object.entries(calculated.changes)) {
      // eslint-disable-next-line no-await-in-loop
      const player = await databaseConnection.get(STORES.player, UUID);
      if (!player) continue;
      playerPuts.push({ store: STORES.player, record: { ...player, elo: change.newElo } });
    }
    const updatedMatch = {
      ...match,
      result: {
        ...match.result,
        playerEloChanges: calculated.changes,
        playerEloChangesVersion: 1,
        ...(ownerChange ? {
          oldElo: ownerChange.oldElo,
          newElo: ownerChange.newElo,
          eloChange: ownerChange.change,
          eloBreakdown: ownerChange.breakdown,
        } : {}),
      },
    };
    await databaseConnection.commitAtomicMutation({
      label: 'post-match-elo',
      puts: [{ store: STORES.match, record: updatedMatch }, ...playerPuts],
      flush: false,
      queueDerived: false,
    });
    return { updated: true, playerCount: playerPuts.length };
  });
}

async function processLeaderboard(databaseConnection) {
  await queueMaterializedLeaderboardRebuild(databaseConnection, {
    scopes: [LEADERBOARD_REBUILD_SCOPE.match, LEADERBOARD_REBUILD_SCOPE.lobby],
    reason: 'post-match-committed',
  });
  return { updated: true };
}

async function processAchievements(databaseConnection, matchUUID, context = {}) {
  const match = await databaseConnection.get(STORES.match, matchUUID);
  if (!match?.result || !match.parent) return { updated: false };
  await databaseConnection.ensureDomainLoaded?.('achievements');
  const teams = getMatchTeams(match);
  const viewerTeamIdx = teams.findIndex((team) => team.some((participant) => String(participant.UUID) === String(match.parent)));
  const opponentTeam = viewerTeamIdx === 0 ? teams[1] : teams[0];
  const owner = teams.flat().find((participant) => String(participant.UUID) === String(match.parent));
  const opponentRankAdvantage = opponentTeam?.length
    ? Math.min(...opponentTeam.map((candidate) => getRankGroupIndex(candidate.elo || 0)))
      - getRankGroupIndex(owner?.elo || 0)
    : 0;
  const viewerScore = finite(match.result.playerScores?.[match.parent]);
  const viewerTeamScore = viewerTeamIdx === 0 ? finite(match.result.team1Total) : finite(match.result.team2Total);
  const scoreDelta = viewerTeamIdx === 0
    ? finite(match.result.team1Total) - finite(match.result.team2Total)
    : finite(match.result.team2Total) - finite(match.result.team1Total);
  const event = createAchievementEvent({
    type: ACHIEVEMENT_EVENT_TYPE.matchCompleted,
    parent: match.parent,
    sourceUUID: match.UUID,
    occurredAt: match.result.concludedAt,
    payload: {
      won: !!match.result.iWon,
      scoreMargin: Math.round(scoreDelta),
      opponentRankAdvantage,
      teamContributionRatio: viewerTeamScore > 0 ? viewerScore / viewerTeamScore : 0,
      eloChange: finite(match.result.eloChange),
      newElo: finite(match.result.newElo),
    },
  });
  await recordAchievementEvent(databaseConnection, event);
  const processed = await processAchievementEvent(databaseConnection, event, {
    onEarned: context.onAchievementEarned,
  });
  return { updated: true, earned: processed.earned || [] };
}

function contributionSummary(match) {
  const scores = match?.result?.playerScores || {};
  const total = Object.values(scores).reduce((sum, value) => sum + finite(value), 0);
  const byPlayer = Object.fromEntries(Object.entries(scores).map(([UUID, value]) => [UUID, {
    points: finite(value),
    share: total > 0 ? finite(value) / total : 0,
  }]));
  const mvpUUID = Object.entries(scores).sort((left, right) => finite(right[1]) - finite(left[1]))[0]?.[0] || null;
  return { version: 1, totalPoints: total, mvpUUID, byPlayer };
}

async function processContribution(databaseConnection, matchUUID) {
  return withMatchMutationLock(databaseConnection, matchUUID, async () => {
    const match = await databaseConnection.get(STORES.match, matchUUID);
    if (!match?.result) return { updated: false };
    if (match.result.contributionSummary?.version === 1) return { updated: false, alreadyApplied: true };
    const summary = contributionSummary(match);
    await databaseConnection.commitAtomicMutation({
      label: 'post-match-contribution-summary',
      puts: [{
        store: STORES.match,
        record: { ...match, result: { ...match.result, contributionSummary: summary } },
      }],
      flush: false,
      queueDerived: false,
    });
    return { updated: true, mvpUUID: summary.mvpUUID };
  });
}

function yieldForFallback() {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 1200 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function runNarrationWorker(payload, signal) {
  if (typeof Worker === 'undefined') {
    await yieldForFallback();
    if (signal?.aborted) throw Object.assign(new Error('Narration cancelled.'), { name: 'AbortError' });
    return buildMatchHighlights(payload);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./MatchPostMatchWorker.js', import.meta.url), { type: 'module' });
    const id = `match-narration-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      const error = new Error('Narration cancelled.');
      error.name = 'AbortError';
      reject(error);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event) => {
      if (event.data?.id !== id) return;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result);
    };
    worker.onerror = (event) => {
      cleanup();
      reject(event.error || new Error(event.message || 'Match narration worker failed.'));
    };
    worker.postMessage({ id, type: 'match-narration', payload });
  });
}

async function processNarration(databaseConnection, matchUUID, signal) {
  const initial = await databaseConnection.get(STORES.match, matchUUID);
  if (!initial?.result) return { updated: false };
  if (initial.result.highlights?.cards) return { updated: false, alreadyApplied: true };
  const payload = {
    match: initial,
    finalScores: initial.result.playerScores || {},
    eventHistory: initial.result.postMatchInput?.eventHistory || [],
    currentPlayerUUID: initial.parent,
    completedTasks: initial.result.postMatchInput?.completedTasks || [],
  };
  const highlights = await runNarrationWorker(payload, signal);
  if (signal?.aborted) return { updated: false, cancelled: true };
  return withMatchMutationLock(databaseConnection, matchUUID, async () => {
    const match = await databaseConnection.get(STORES.match, matchUUID);
    if (!match?.result || match.result.highlights?.cards) return { updated: false, alreadyApplied: true };
    await databaseConnection.commitAtomicMutation({
      label: 'post-match-narration',
      puts: [{
        store: STORES.match,
        record: { ...match, result: { ...match.result, highlights } },
      }],
      flush: false,
      queueDerived: false,
    });
    return { updated: true, cardCount: highlights?.cards?.length || 0 };
  });
}

async function processCache(databaseConnection, matchUUID) {
  databaseConnection.invalidateMatchDerivedCaches?.(matchUUID);
  await databaseConnection.flushLinkedFolderWrite?.();
  return { invalidated: true };
}

async function processDojoEffects(databaseConnection, matchUUID) {
  const match = await databaseConnection.get(STORES.match, matchUUID);
  if (!match?.parent) return { updated: false };
  await databaseConnection.ensureDomainLoaded?.('eventBuffs');
  const activeBuffs = await databaseConnection.getActiveEventBuffsForPlayer(match.parent).catch(() => []);
  const dojoBuff = (activeBuffs || []).find((buff) => buff?.eventUUID === SPECIAL_EVENT_IDS.dojoMultiplier);
  await clearDojoMultiplier(databaseConnection, match.parent);
  if (!dojoBuff || match.result?.dojoMomentum?.consumed) return { updated: !!dojoBuff };
  return withMatchMutationLock(databaseConnection, matchUUID, async () => {
    const current = await databaseConnection.get(STORES.match, matchUUID);
    if (!current?.result || current.result.dojoMomentum?.consumed) return { updated: false, alreadyApplied: true };
    const multiplierValue = finite(dojoBuff.multiplierValue, 1);
    await databaseConnection.commitAtomicMutation({
      label: 'post-match-dojo-effect',
      puts: [{
        store: STORES.match,
        record: {
          ...current,
          result: {
            ...current.result,
            dojoMomentum: { consumed: true, multiplierValue },
          },
        },
      }],
      flush: false,
      queueDerived: false,
    });
    return { updated: true, multiplierValue };
  });
}

function handlerForType(databaseConnection, type, context) {
  const handlers = {
    [MATCH_JOB_TYPE.elo]: (record) => processElo(databaseConnection, record.matchUUID),
    [MATCH_JOB_TYPE.leaderboard]: () => processLeaderboard(databaseConnection),
    [MATCH_JOB_TYPE.achievements]: (record) => processAchievements(databaseConnection, record.matchUUID, context),
    [MATCH_JOB_TYPE.contribution]: (record) => processContribution(databaseConnection, record.matchUUID),
    [MATCH_JOB_TYPE.narration]: (record, schedulerContext) => processNarration(databaseConnection, record.matchUUID, schedulerContext.signal),
    [MATCH_JOB_TYPE.cache]: (record) => processCache(databaseConnection, record.matchUUID),
    [MATCH_JOB_TYPE.dojoEffects]: (record) => processDojoEffects(databaseConnection, record.matchUUID),
  };
  return handlers[type];
}

function getSchedulerState(databaseConnection, context = {}) {
  let state = schedulerStateByConnection.get(databaseConnection);
  if (!state) {
    state = {
      context: { ...context },
      scheduler: new BackgroundJobScheduler({
        name: 'post-match',
        concurrency: 2,
        maxQueue: 96,
        maxHistory: 160,
        retryBaseMs: 750,
      }),
    };
    for (const spec of JOB_SPECS) {
      state.scheduler.register(spec.type, (payload, schedulerContext) => (
        runPersistedJob(
          databaseConnection,
          payload,
          schedulerContext,
          (record, runContext) => handlerForType(databaseConnection, spec.type, state.context)(record, runContext),
        )
      ), spec);
    }
    schedulerStateByConnection.set(databaseConnection, state);
  } else {
    state.context = { ...state.context, ...context };
  }
  return state;
}

function createJobRecord(match, spec) {
  const timestamp = nowISO();
  return {
    UUID: postMatchJobUUID(match.UUID, spec.type),
    parent: match.parent,
    matchUUID: match.UUID,
    type: spec.type,
    priority: spec.priority,
    execution: spec.execution,
    state: 'queued',
    attempts: 0,
    maxAttempts: spec.maxAttempts,
    schemaVersion: MATCH_JOB_SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

export async function queuePostMatchJobs(databaseConnection, matchOrId, context = {}) {
  if (!databaseConnection || !matchOrId) return [];
  const match = typeof matchOrId === 'string'
    ? await databaseConnection.get(STORES.match, matchOrId)
    : matchOrId;
  if (!match?.UUID || Number(match.result?.postProcessingVersion) !== MATCH_POST_PROCESSING_VERSION) return [];
  const state = getSchedulerState(databaseConnection, context);
  const handles = [];
  for (const spec of JOB_SPECS) {
    const receiptId = postMatchReceiptUUID(match.UUID, spec.type);
    // eslint-disable-next-line no-await-in-loop
    const receipt = await databaseConnection.get(STORES.backgroundJobReceipt, receiptId).catch(() => null);
    if (['completed', 'cancelled'].includes(receipt?.status)) continue;
    const record = createJobRecord(match, spec);
    // eslint-disable-next-line no-await-in-loop
    const existing = await databaseConnection.get(STORES.backgroundJob, record.UUID).catch(() => null);
    const durableRecord = existing?.state === 'completed' ? existing : { ...record, ...(existing || {}), state: 'queued', updatedAt: nowISO() };
    // eslint-disable-next-line no-await-in-loop
    await databaseConnection.add(STORES.backgroundJob, durableRecord);
    handles.push(state.scheduler.enqueue({
      id: durableRecord.UUID,
      type: spec.type,
      payload: { jobRecord: durableRecord },
      dedupeKey: durableRecord.UUID,
      priority: spec.priority,
      maxAttempts: spec.maxAttempts,
      metadata: { matchUUID: match.UUID, parent: match.parent },
    }));
  }
  return handles;
}

export async function recoverPendingPostMatchJobs(databaseConnection, context = {}) {
  if (!databaseConnection) return [];
  const matches = await databaseConnection.getAll(STORES.match);
  const eligible = matches
    .filter((match) => Number(match?.result?.postProcessingVersion) === MATCH_POST_PROCESSING_VERSION)
    .sort((left, right) => (
      String(left.result?.concludedAt || left.createdAt || '').localeCompare(String(right.result?.concludedAt || right.createdAt || ''))
      || String(left.UUID).localeCompare(String(right.UUID))
    ));
  const handles = [];
  for (const match of eligible) {
    // eslint-disable-next-line no-await-in-loop
    handles.push(...await queuePostMatchJobs(databaseConnection, match, context));
  }
  return handles;
}

export async function cancelPostMatchJobs(databaseConnection, matchUUID, reason = 'Post-match work cancelled.') {
  if (!databaseConnection || !matchUUID) return 0;
  const state = schedulerStateByConnection.get(databaseConnection);
  const schedulerCancelled = state
    ? state.scheduler.cancelWhere((job) => job.metadata?.matchUUID === matchUUID, reason)
    : 0;
  const records = await databaseConnection.getAll(STORES.backgroundJob).catch(() => []);
  const pending = (records || []).filter((record) => (
    String(record?.matchUUID) === String(matchUUID)
    && !['completed', 'cancelled'].includes(record?.state)
  ));
  if (!pending.length) return schedulerCancelled;
  const timestamp = nowISO();
  const puts = [];
  for (const record of pending) {
    puts.push({
      store: STORES.backgroundJob,
      record: {
        ...record,
        state: 'cancelled',
        completedAt: timestamp,
        updatedAt: timestamp,
        error: String(reason),
      },
    });
    puts.push({
      store: STORES.backgroundJobReceipt,
      record: {
        UUID: postMatchReceiptUUID(record.matchUUID, record.type),
        parent: record.parent,
        matchUUID: record.matchUUID,
        jobUUID: record.UUID,
        type: record.type,
        processorVersion: MATCH_JOB_SCHEMA_VERSION,
        status: 'cancelled',
        attempts: Number(record.attempts) || 0,
        createdAt: record.createdAt || timestamp,
        updatedAt: timestamp,
        completedAt: timestamp,
        result: null,
        error: String(reason),
      },
    });
  }
  await databaseConnection.commitAtomicMutation({
    label: 'post-match-jobs-cancelled',
    puts,
    flush: false,
    queueDerived: false,
  });
  return Math.max(schedulerCancelled, pending.length);
}

export function getPostMatchJobSummary(databaseConnection) {
  return schedulerStateByConnection.get(databaseConnection)?.scheduler.summary() || null;
}

export { JOB_SPECS as POST_MATCH_JOB_SPECS };
