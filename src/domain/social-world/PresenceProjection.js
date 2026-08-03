import {
  PRESENCE_CLAIM,
  PRESENCE_STATE,
  RECENT_TRACE_WINDOW_IGT_MS,
  SEMANTIC_LOCATION,
  isMeaningfulActivityKind,
  isSemanticLocation,
} from './SocialWorldContracts.js';

const EMPTY_RESULT = Object.freeze({
  intervalId: null,
  state: PRESENCE_STATE.inactive,
  location: null,
  claim: PRESENCE_CLAIM.none,
  elapsedHere: null,
  activeElapsed: null,
  startedIGT: null,
  endedIGT: null,
  lastActiveIGT: null,
  sourceType: null,
  sourceId: null,
  paused: false,
});

function intervalIdentity(interval) {
  const value = interval?.intervalId ?? interval?.id ?? interval?.UUID;
  return value == null || String(value).trim() === '' ? null : String(value);
}

export function projectElapsed(interval, viewerIGT, nowMs, {
  isExactCurrent = interval?.endedIGT == null,
} = {}) {
  const normalized = normalizeInterval(interval);
  const cursor = asFiniteNonNegative(viewerIGT);
  if (!normalized || cursor == null || cursor < normalized.startedIGT) {
    return Object.freeze({ elapsedHere: null, activeElapsed: null });
  }

  const boundaryIGT = normalized.endedIGT == null
    ? cursor
    : Math.min(cursor, normalized.endedIGT);
  const elapsedHere = Math.max(0, boundaryIGT - normalized.startedIGT);
  const projectedActiveElapsed = projectActiveElapsed(
    normalized,
    boundaryIGT,
    nowMs,
    isExactCurrent,
  );
  const activeElapsed = projectedActiveElapsed == null
    ? null
    : Math.min(elapsedHere, projectedActiveElapsed);

  return Object.freeze({ elapsedHere, activeElapsed });
}

export function projectPresence({
  intervals = [],
  traces = [],
  viewerIGT,
  isActiveProfile = false,
  nowMs,
  recentWindowIGT = RECENT_TRACE_WINDOW_IGT_MS,
} = {}) {
  const cursor = asFiniteNonNegative(viewerIGT);
  if (cursor == null) return EMPTY_RESULT;

  const normalizedIntervals = intervals
    .map(normalizeInterval)
    .filter(Boolean);
  const normalizedTraces = traces
    .map(normalizeTrace)
    .filter(Boolean);

  const coveringInterval = selectCoveringInterval(
    normalizedIntervals,
    cursor,
    isActiveProfile,
  );

  if (coveringInterval) {
    const isExactCurrent = isActiveProfile && coveringInterval.endedIGT == null;
    const elapsed = projectElapsed(coveringInterval, cursor, nowMs, { isExactCurrent });
    return Object.freeze({
      intervalId: intervalIdentity(coveringInterval),
      state: isExactCurrent ? PRESENCE_STATE.current : PRESENCE_STATE.projected,
      location: coveringInterval.location,
      claim: isExactCurrent
        ? PRESENCE_CLAIM.exactCurrent
        : PRESENCE_CLAIM.recordedInterval,
      ...elapsed,
      startedIGT: coveringInterval.startedIGT,
      endedIGT: coveringInterval.endedIGT,
      lastActiveIGT: cursor,
      sourceType: coveringInterval.sourceType || null,
      sourceId: coveringInterval.sourceId || null,
      paused: isExactCurrent
        && coveringInterval.tracksActiveElapsed
        && coveringInterval.activeAnchorAt == null,
    });
  }

  const latestInterval = selectLatestEndedInterval(normalizedIntervals, cursor);
  const latestTrace = selectLatestTrace(normalizedTraces, cursor);
  const intervalBoundary = latestInterval?.endedIGT ?? -1;
  const traceBoundary = latestTrace?.inGameTimestamp ?? -1;
  const latestEvidence = intervalBoundary >= traceBoundary
    ? (latestInterval && { type: 'interval', value: latestInterval, boundary: intervalBoundary })
    : (latestTrace && { type: 'trace', value: latestTrace, boundary: traceBoundary });
  const lastActiveIGT = deriveLastActiveFromNormalized(
    normalizedIntervals,
    normalizedTraces,
    cursor,
  );

  if (latestEvidence && cursor - latestEvidence.boundary <= normalizedWindow(recentWindowIGT)) {
    if (latestEvidence.type === 'interval') {
      const elapsed = projectElapsed(
        latestEvidence.value,
        latestEvidence.value.endedIGT,
        nowMs,
        { isExactCurrent: false },
      );
      return Object.freeze({
        intervalId: intervalIdentity(latestEvidence.value),
        state: PRESENCE_STATE.recent,
        location: latestEvidence.value.location,
        claim: PRESENCE_CLAIM.recentInterval,
        ...elapsed,
        startedIGT: latestEvidence.value.startedIGT,
        endedIGT: latestEvidence.value.endedIGT,
        lastActiveIGT,
        sourceType: latestEvidence.value.sourceType || null,
        sourceId: latestEvidence.value.sourceId || null,
        paused: false,
      });
    }

    return Object.freeze({
      intervalId: null,
      state: PRESENCE_STATE.recent,
      location: latestEvidence.value.location,
      claim: PRESENCE_CLAIM.activityTrace,
      elapsedHere: null,
      activeElapsed: null,
      startedIGT: null,
      endedIGT: latestEvidence.value.inGameTimestamp,
      lastActiveIGT,
      sourceType: latestEvidence.value.kind,
      sourceId: latestEvidence.value.id || null,
      paused: false,
    });
  }

  return Object.freeze({
    ...EMPTY_RESULT,
    claim: lastActiveIGT == null ? PRESENCE_CLAIM.none : PRESENCE_CLAIM.lastActive,
    lastActiveIGT,
  });
}

export function deriveLastActiveIGT({ intervals = [], traces = [], viewerIGT } = {}) {
  const cursor = asFiniteNonNegative(viewerIGT);
  if (cursor == null) return null;
  return deriveLastActiveFromNormalized(
    intervals.map(normalizeInterval).filter(Boolean),
    traces.map(normalizeTrace).filter(Boolean),
    cursor,
  );
}

function deriveLastActiveFromNormalized(intervals, traces, cursor) {
  const candidates = [];

  intervals.forEach((interval) => {
    if (interval.startedIGT > cursor) return;
    if (interval.endedIGT == null) {
      const observedBoundary = interval.lastObservedIGT == null
        ? interval.startedIGT
        : Math.min(cursor, interval.lastObservedIGT);
      candidates.push(observedBoundary);
      return;
    }
    candidates.push(Math.min(cursor, interval.endedIGT));
  });

  traces.forEach((trace) => {
    if (trace.inGameTimestamp <= cursor) candidates.push(trace.inGameTimestamp);
  });

  return candidates.length ? Math.max(...candidates) : null;
}

export function closePresenceIntervalAtBoundary(interval, {
  endedIGT,
  exitedAt,
  interruption,
  nowMs,
} = {}) {
  const normalized = normalizeInterval(interval);
  const boundary = asFiniteNonNegative(endedIGT);
  if (!normalized || boundary == null) return null;

  const requestedBoundary = Math.max(normalized.startedIGT, boundary);
  // Closing is idempotent: a known end boundary is never moved by a retry.
  const closedIGT = normalized.endedIGT ?? requestedBoundary;
  const wallBoundary = Number.isFinite(nowMs)
    ? nowMs
    : parseWallTime(exitedAt);
  const projectedActiveElapsed = projectActiveElapsed(
    normalized,
    closedIGT,
    wallBoundary,
    true,
  );
  const activeElapsedMs = projectedActiveElapsed == null
    ? null
    : Math.min(closedIGT - normalized.startedIGT, projectedActiveElapsed);

  return Object.freeze({
    ...interval,
    location: normalized.location,
    startedIGT: normalized.startedIGT,
    endedIGT: closedIGT,
    lastObservedIGT: closedIGT,
    exitedAt: exitedAt || (Number.isFinite(wallBoundary)
      ? new Date(wallBoundary).toISOString()
      : null),
    activeElapsedMs,
    activeAnchorAt: null,
    closeReason: interruption || null,
  });
}

function projectActiveElapsed(interval, boundaryIGT, nowMs, isExactCurrent) {
  if (!interval.tracksActiveElapsed) return null;

  if (interval.activeSegments.length) {
    return interval.activeSegments.reduce((total, segment) => {
      const start = Math.max(interval.startedIGT, segment.startedIGT);
      if (start >= boundaryIGT) return total;
      const end = segment.endedIGT == null
        ? boundaryIGT
        : Math.min(boundaryIGT, segment.endedIGT);
      return total + Math.max(0, end - start);
    }, 0);
  }

  const stored = Math.max(0, interval.activeElapsedMs);
  if (interval.endedIGT != null && interval.endedIGT <= boundaryIGT) return stored;

  // A final stored total would leak work after the viewer's cursor. Without
  // active segments, historical mid-interval productive time is unknowable.
  if (!isExactCurrent) return null;
  if (!interval.activeAnchorAt) return stored;

  const anchorMs = parseWallTime(interval.activeAnchorAt);
  const cursorMs = Number(nowMs);
  if (!Number.isFinite(anchorMs) || !Number.isFinite(cursorMs)) return stored;
  return stored + Math.max(0, cursorMs - anchorMs);
}

function normalizeInterval(interval) {
  if (!interval || !isSemanticLocation(interval.location)) return null;
  const startedIGT = asFiniteNonNegative(interval.startedIGT ?? interval.started_igt);
  if (startedIGT == null) return null;
  const rawEndedIGT = interval.endedIGT ?? interval.ended_igt;
  const endedIGT = rawEndedIGT == null ? null : asFiniteNonNegative(rawEndedIGT);
  if (rawEndedIGT != null && endedIGT == null) return null;
  if (endedIGT != null && endedIGT < startedIGT) return null;
  const rawLastObservedIGT = interval.lastObservedIGT ?? interval.last_observed_igt;
  const lastObservedIGT = rawLastObservedIGT == null
    ? null
    : asFiniteNonNegative(rawLastObservedIGT);
  if (lastObservedIGT != null && lastObservedIGT < startedIGT) return null;

  return {
    ...interval,
    location: interval.location,
    startedIGT,
    endedIGT,
    lastObservedIGT,
    activeElapsedMs: Math.max(
      0,
      Number(interval.activeElapsedMs ?? interval.active_elapsed_ms) || 0,
    ),
    activeAnchorAt: interval.activeAnchorAt ?? interval.active_anchor_at ?? null,
    tracksActiveElapsed: interval.tracksActiveElapsed
      ?? interval.tracks_active_elapsed
      ?? false,
    activeSegments: normalizeActiveSegments(
      interval.activeSegments ?? interval.active_segments ?? [],
    ),
  };
}

function normalizeTrace(trace) {
  if (!trace || !isMeaningfulActivityKind(trace.kind)) return null;
  const inGameTimestamp = asFiniteNonNegative(
    trace.inGameTimestamp ?? trace.in_game_timestamp ?? trace.endedIGT ?? trace.ended_igt,
  );
  if (inGameTimestamp == null) return null;
  const location = isSemanticLocation(trace.location)
    ? trace.location
    : locationFromMeaningfulKind(trace.kind);
  return { ...trace, inGameTimestamp, location };
}

function locationFromMeaningfulKind(kind) {
  const prefix = String(kind).replace(/-(started|completed|entered|exited|concluded)$/, '');
  if (prefix === 'task-session') return SEMANTIC_LOCATION.taskSession;
  if (prefix === 'dojo') return SEMANTIC_LOCATION.dojo;
  if (prefix === 'match') return SEMANTIC_LOCATION.matchArena;
  if (prefix === 'planning') return SEMANTIC_LOCATION.planning;
  if (prefix === 'marketplace') return SEMANTIC_LOCATION.marketplace;
  if (prefix === 'commons') return SEMANTIC_LOCATION.commons;
  return null;
}

function normalizeActiveSegments(segments) {
  if (!Array.isArray(segments)) return [];
  return segments.map((segment) => {
    const startedIGT = asFiniteNonNegative(segment?.startedIGT ?? segment?.started_igt);
    const rawEnd = segment?.endedIGT ?? segment?.ended_igt;
    const endedIGT = rawEnd == null ? null : asFiniteNonNegative(rawEnd);
    if (startedIGT == null || (rawEnd != null && endedIGT == null)) return null;
    return {
      startedIGT,
      endedIGT: endedIGT == null ? null : Math.max(startedIGT, endedIGT),
    };
  }).filter(Boolean);
}

function projectionEndIGT(interval, isActiveProfile) {
  if (interval.endedIGT != null) return interval.endedIGT;
  if (isActiveProfile) return Number.POSITIVE_INFINITY;
  // An unclosed interval belonging to another profile must be bounded by its
  // last observation. Missing evidence never means indefinite projection.
  return interval.lastObservedIGT ?? interval.startedIGT;
}

function selectCoveringInterval(intervals, cursor, isActiveProfile) {
  return intervals.reduce((selected, interval) => {
    const coversCursor = interval.startedIGT <= cursor
      && cursor < projectionEndIGT(interval, isActiveProfile);
    if (!coversCursor) return selected;
    return intervalIsNewer(interval, selected) ? interval : selected;
  }, null);
}

function selectLatestEndedInterval(intervals, cursor) {
  return intervals.reduce((selected, interval) => {
    if (interval.endedIGT == null || interval.endedIGT > cursor) return selected;
    if (!selected || interval.endedIGT > selected.endedIGT) return interval;
    if (interval.endedIGT < selected.endedIGT) return selected;
    return intervalIsNewer(interval, selected) ? interval : selected;
  }, null);
}

function selectLatestTrace(traces, cursor) {
  return traces.reduce((selected, trace) => {
    if (trace.inGameTimestamp > cursor) return selected;
    if (!selected || trace.inGameTimestamp > selected.inGameTimestamp) return trace;
    if (trace.inGameTimestamp < selected.inGameTimestamp) return selected;
    const traceId = String(trace.id ?? trace.UUID ?? '');
    const selectedId = String(selected.id ?? selected.UUID ?? '');
    return traceId.localeCompare(selectedId) < 0 ? trace : selected;
  }, null);
}

function intervalIsNewer(candidate, selected) {
  if (!selected || candidate.startedIGT > selected.startedIGT) return true;
  if (candidate.startedIGT < selected.startedIGT) return false;
  const candidateId = String(candidate.id ?? candidate.UUID ?? '');
  const selectedId = String(selected.id ?? selected.UUID ?? '');
  return candidateId.localeCompare(selectedId) < 0;
}

function normalizedWindow(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : RECENT_TRACE_WINDOW_IGT_MS;
}

function asFiniteNonNegative(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function parseWallTime(value) {
  if (value == null || value === '') return null;
  if (Number.isFinite(value)) return Number(value);
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}
