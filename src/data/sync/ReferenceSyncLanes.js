import {
  publishCurrentMobileResources,
  synchronizeMobileReferenceChanges,
} from './MobileReferenceSync.js';

export const REFERENCE_SYNC_LANE = Object.freeze({
  live: 'live',
  prompt: 'prompt',
  background: 'background',
});

export const LIVE_REFERENCE_TYPES = Object.freeze([
  'active-profile-state',
  'completed-task',
  'action-session',
  'match',
  'match-score-event',
]);

export const PROMPT_REFERENCE_TYPES = Object.freeze([
  ...LIVE_REFERENCE_TYPES,
  'profile',
  'task',
  'goal',
  'goal-area',
  'goal-milestone',
  'goal-update',
  'goal-link',
  'goal-participant',
  'task-completion-event',
  'task-completion-receipt',
  'reminder',
  'shop-catalog',
  'inventory',
  'transaction',
  'journal',
  'journal-comment',
  'chronicle-entry-metadata',
  'chronicle-entry-revision',
  'chronicle-entry-access',
  'chronicle-story',
  'chronicle-story-entry',
  'chronicle-entry-link',
  'chronicle-reaction',
  'event',
  'custom-event',
  'event-log',
  'event-buff',
  'rhythm-definition',
  'rhythm-opportunity',
  'friendship',
  'notification',
]);

const RESOURCE_BEARING_REFERENCE_TYPES = new Set([
  'profile',
  'shop-catalog',
  'journal',
  'chronicle-entry-metadata',
]);

const laneState = new WeakMap();
const PASSIVE_LIVE_REASONS = new Set(['visible-live-state']);

function stateFor(databaseConnection) {
  let state = laneState.get(databaseConnection);
  if (!state) {
    state = {
      live: null,
      liveFollowUpRequested: false,
      liveFollowUpReason: null,
      promptTimer: null,
      promptPromise: null,
      targetedTail: Promise.resolve(),
    };
    laneState.set(databaseConnection, state);
  }
  return state;
}

function enqueueTargetedSync(databaseConnection, options) {
  const state = stateFor(databaseConnection);
  const run = () => synchronizeReferenceTypes(databaseConnection, options);
  const request = state.targetedTail.then(run, run);
  state.targetedTail = request.catch(() => undefined);
  return request;
}

export async function synchronizeReferenceTypes(databaseConnection, {
  recordTypes = LIVE_REFERENCE_TYPES,
  reason = 'targeted-reference-sync',
} = {}) {
  const runtime = databaseConnection?.syncRuntime;
  const transport = runtime?.transport;
  const types = [...new Set((recordTypes || []).map(String).filter(Boolean))];
  if (!runtime || !transport?.getMobileReferenceChanges || !types.length) {
    return { synchronized: false, reason: 'reference-delta-transport-unavailable', applied: 0 };
  }

  await runtime.ensureDeviceRegistered();

  // A reference row may point at an avatar, cosmetic preview, or Chronicle
  // attachment. Publish the bytes before the row so a realtime receiver never
  // observes a record whose resource is not yet available.
  const resourceTypes = types.filter((type) => RESOURCE_BEARING_REFERENCE_TYPES.has(type));
  if (runtime.checkpointPublishingEnabled && resourceTypes.length) {
    const pendingResources = runtime.referenceOutbox?.listPending
      ? await runtime.referenceOutbox.listPending({ limit: 1, recordTypes: resourceTypes })
      : [true];
    if (pendingResources.length) {
      await publishCurrentMobileResources(databaseConnection, transport);
    }
  }

  // Upload only the records touched by this workflow. The subsequent pull is
  // global and cursor-based so a filtered lane can never advance past another
  // record type and accidentally strand it.
  const durable = await runtime.flushReferenceOutbox({ recordTypes: types, limit: 250 });
  const delta = await synchronizeMobileReferenceChanges(databaseConnection, transport, {
    forceActiveProfile: false,
    reason,
  });

  await databaseConnection.flushSyncProjections?.();

  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('tapestry:reference-sync-complete', {
      detail: {
        reason,
        recordTypes: delta.recordTypes || [],
        uploaded: Number(durable.uploaded || 0),
        applied: Number(delta.applied || 0),
        downloaded: Number(delta.downloaded || 0),
        cursor: Number(delta.cursor || 0),
      },
    }));
  }

  return {
    synchronized: true,
    reason,
    recordTypes: delta.recordTypes || [],
    uploaded: Number(durable.uploaded || 0),
    ...delta,
  };
}

export function requestReferenceSync(databaseConnection, {
  lane = REFERENCE_SYNC_LANE.background,
  reason = `${lane}-reference-sync`,
} = {}) {
  const runtime = databaseConnection?.syncRuntime;
  if (!runtime?.transport) return Promise.resolve({ synchronized: false, reason: 'local-only' });
  if (lane === REFERENCE_SYNC_LANE.background) {
    runtime.scheduleSync(reason);
    return Promise.resolve({ synchronized: false, scheduled: true, lane });
  }

  const state = stateFor(databaseConnection);
  if (lane === REFERENCE_SYNC_LANE.live) {
    if (state.live) {
      if (PASSIVE_LIVE_REASONS.has(reason)) return state.live;
      state.liveFollowUpRequested = true;
      state.liveFollowUpReason = reason;
      return state.live;
    }
    state.live = (async () => {
      let result = null;
      let nextReason = reason;
      do {
        state.liveFollowUpRequested = false;
        state.liveFollowUpReason = null;
        // eslint-disable-next-line no-await-in-loop
        result = await enqueueTargetedSync(databaseConnection, {
          recordTypes: LIVE_REFERENCE_TYPES,
          reason: nextReason,
        });
        nextReason = state.liveFollowUpReason || 'coalesced-live-reference-sync';
      } while (state.liveFollowUpRequested);
      return result;
    })().finally(() => {
      state.live = null;
      state.liveFollowUpRequested = false;
      state.liveFollowUpReason = null;
    });
    return state.live;
  }

  if (state.promptPromise) return state.promptPromise;
  state.promptPromise = new Promise((resolve) => {
    state.promptTimer = globalThis.setTimeout(() => {
      state.promptTimer = null;
      enqueueTargetedSync(databaseConnection, {
        recordTypes: PROMPT_REFERENCE_TYPES,
        reason,
      }).then(resolve, () => resolve({ synchronized: false, reason: 'prompt-sync-failed' }))
        .finally(() => { state.promptPromise = null; });
    }, 750);
  });
  return state.promptPromise;
}

export const requestLiveReferenceSync = (databaseConnection, reason) => (
  requestReferenceSync(databaseConnection, { lane: REFERENCE_SYNC_LANE.live, reason })
);

export const requestPromptReferenceSync = (databaseConnection, reason) => (
  requestReferenceSync(databaseConnection, { lane: REFERENCE_SYNC_LANE.prompt, reason })
);

export default requestReferenceSync;
