import { MINUTE } from '@domain/constants.js';

const RECENT_COMPLETION_MS = 10 * MINUTE;
const DEEP_FOCUS_MS = 20 * MINUTE;
const CHARGING_POINTS = 160;

const FALLBACK_ACTIVITIES = [
  'calculus drill',
  'debugging pass',
  'research notes',
  'essay draft',
  'equation set',
  'biology review',
  'project work',
  'practice block',
  'reading pass',
  'language drill',
  'flashcards',
  'exam prep',
];

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const toFiniteNumber = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const hashString = (s = '') => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (((h << 5) - h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

const cleanTaskName = (name, fallback = 'task') => {
  const text = String(name || '').trim();
  return text || fallback;
};

const getReplaySessions = (player) => (
  Array.isArray(player?.replayTrace?.sessions)
    ? [...player.replayTrace.sessions].sort((a, b) => (
      toFiniteNumber(a.startOffset) - toFiniteNumber(b.startOffset)
    ))
    : []
);

function getFallbackTaskName(player, elapsedRatio) {
  const names = Array.isArray(player?.recentTaskNames)
    ? player.recentTaskNames.filter(Boolean)
    : [];
  const bucket = Math.floor(clamp(elapsedRatio, 0, 0.999) * 12);
  const seed = hashString(`${player?.UUID || 'ghost'}-${bucket}`);
  const source = names.length ? names : FALLBACK_ACTIVITIES;
  return cleanTaskName(source[seed % source.length], 'work block');
}

function buildIdleState(label, overrides = {}) {
  return {
    status: 'idle',
    label,
    taskName: null,
    progressRatio: 0,
    pendingPoints: 0,
    timeToCompletionMs: null,
    lastCompletedTaskName: null,
    lastCompletedPoints: 0,
    lastCompletedAgoMs: null,
    isReplayBased: false,
    confidence: 'estimated',
    ...overrides,
  };
}

function getCurrentPlayerActivity(activeTask, context) {
  const now = toFiniteNumber(context.now, Date.now());
  if (!activeTask?.createdAt) {
    return buildIdleState('Available', {
      confidence: 'exact',
      isCurrentPlayer: true,
    });
  }

  const startMs = new Date(activeTask.createdAt).getTime();
  const elapsedTaskMs = Number.isFinite(startMs) ? Math.max(0, now - startMs) : 0;
  const committedMs = Math.max(
    toFiniteNumber(activeTask.sessionDuration),
    toFiniteNumber(activeTask.estimatedDuration) * MINUTE,
  );
  const progressRatio = committedMs > 0 ? clamp(elapsedTaskMs / committedMs) : 0;
  const taskName = cleanTaskName(activeTask.name, 'current task');
  const status = progressRatio >= 0.82
    ? 'charging'
    : elapsedTaskMs >= DEEP_FOCUS_MS
      ? 'deep_focus'
      : 'active';
  const label = status === 'charging'
    ? `Final stretch: ${taskName}`
    : status === 'deep_focus'
      ? `Deep focus: ${taskName}`
      : `Working: ${taskName}`;

  return {
    status,
    label,
    taskName,
    progressRatio,
    pendingPoints: 0,
    timeToCompletionMs: committedMs > 0 ? Math.max(0, committedMs - elapsedTaskMs) : null,
    lastCompletedTaskName: null,
    lastCompletedPoints: 0,
    lastCompletedAgoMs: null,
    isReplayBased: false,
    confidence: 'exact',
    isCurrentPlayer: true,
  };
}

function getReplayActivity(player, context) {
  const sessions = getReplaySessions(player);
  const durationMs = Math.max(
    toFiniteNumber(context.durationMs),
    toFiniteNumber(player?.replayTrace?.durationMs),
    1,
  );
  const elapsedMs = clamp(toFiniteNumber(context.elapsedMs), 0, durationMs);
  const currentScore = toFiniteNumber(context.currentScore);
  const previousScore = toFiniteNumber(context.previousScore, currentScore);

  const active = sessions.find((session) => (
    toFiniteNumber(session.startOffset) <= elapsedMs
    && elapsedMs < toFiniteNumber(session.endOffset)
  ));

  if (active) {
    const startOffset = toFiniteNumber(active.startOffset);
    const endOffset = Math.max(startOffset + 1, toFiniteNumber(active.endOffset));
    const sessionDuration = Math.max(1, endOffset - startOffset);
    const progressRatio = clamp((elapsedMs - startOffset) / sessionDuration);
    const points = Math.max(0, Math.round(toFiniteNumber(active.points)));
    const taskName = cleanTaskName(active.name, 'work block');
    const timeToCompletionMs = Math.max(0, endOffset - elapsedMs);
    const inSessionMs = Math.max(0, elapsedMs - startOffset);
    const status = points >= CHARGING_POINTS && (progressRatio >= 0.55 || timeToCompletionMs <= 12 * MINUTE)
      ? 'charging'
      : inSessionMs >= DEEP_FOCUS_MS || progressRatio >= 0.5
        ? 'deep_focus'
        : 'active';
    const label = status === 'charging'
      ? `Charging: ${taskName}`
      : status === 'deep_focus'
        ? `Deep focus: ${taskName}`
        : `Working: ${taskName}`;

    return {
      status,
      label,
      taskName,
      progressRatio,
      pendingPoints: points,
      timeToCompletionMs,
      lastCompletedTaskName: null,
      lastCompletedPoints: 0,
      lastCompletedAgoMs: null,
      activeSessionStartOffsetMs: startOffset,
      activeSessionEndOffsetMs: endOffset,
      isReplayBased: true,
      confidence: 'exact',
      scoreDelta: Math.max(0, currentScore - previousScore),
    };
  }

  const completed = sessions
    .filter((session) => toFiniteNumber(session.endOffset) <= elapsedMs)
    .sort((a, b) => toFiniteNumber(b.endOffset) - toFiniteNumber(a.endOffset));
  const last = completed[0] || null;
  if (last) {
    const lastCompletedAgoMs = Math.max(0, elapsedMs - toFiniteNumber(last.endOffset));
    if (lastCompletedAgoMs <= RECENT_COMPLETION_MS) {
      const lastCompletedPoints = Math.max(0, Math.round(toFiniteNumber(last.points)));
      const lastCompletedTaskName = cleanTaskName(last.name, 'task');
      return {
        status: 'recent_complete',
        label: `Completed: ${lastCompletedTaskName}`,
        taskName: null,
        progressRatio: 1,
        pendingPoints: 0,
        timeToCompletionMs: null,
        lastCompletedTaskName,
        lastCompletedPoints,
        lastCompletedAgoMs,
        lastCompletedOffsetMs: toFiniteNumber(last.endOffset),
        isReplayBased: true,
        confidence: 'exact',
        scoreDelta: Math.max(0, currentScore - previousScore),
      };
    }
  }

  const next = sessions.find((session) => toFiniteNumber(session.startOffset) > elapsedMs);
  if (next) {
    const taskName = cleanTaskName(next.name, 'work block');
    const timeToStartMs = Math.max(0, toFiniteNumber(next.startOffset) - elapsedMs);
    return buildIdleState(timeToStartMs <= 8 * MINUTE ? `Preparing: ${taskName}` : 'Warming up', {
      taskName: timeToStartMs <= 8 * MINUTE ? taskName : null,
      timeToCompletionMs: timeToStartMs <= 8 * MINUTE
        ? Math.max(0, toFiniteNumber(next.endOffset) - elapsedMs)
        : null,
      pendingPoints: timeToStartMs <= 8 * MINUTE ? Math.max(0, Math.round(toFiniteNumber(next.points))) : 0,
      isReplayBased: true,
      confidence: 'exact',
      scoreDelta: Math.max(0, currentScore - previousScore),
    });
  }

  return buildIdleState('Trace complete', {
    status: 'finished',
    progressRatio: 1,
    isReplayBased: true,
    confidence: 'exact',
    scoreDelta: Math.max(0, currentScore - previousScore),
  });
}

function getEstimatedActivity(player, context) {
  const durationMs = Math.max(toFiniteNumber(context.durationMs), 1);
  const elapsedMs = clamp(toFiniteNumber(context.elapsedMs), 0, durationMs);
  const elapsedRatio = clamp(elapsedMs / durationMs);
  const currentScore = toFiniteNumber(context.currentScore);
  const previousScore = toFiniteNumber(context.previousScore, currentScore);
  const scoreDelta = Math.max(0, currentScore - previousScore);
  const estimatedTotal = Math.max(0, Math.round(toFiniteNumber(player?.estimatedTotal)));
  const remainingEstimate = Math.max(0, estimatedTotal - currentScore);
  const taskName = getFallbackTaskName(player, elapsedRatio);

  if (elapsedRatio >= 0.985 || (estimatedTotal > 0 && currentScore >= estimatedTotal)) {
    return buildIdleState('Estimated output complete', {
      status: 'finished',
      taskName,
      progressRatio: 1,
      confidence: 'estimated',
      scoreDelta,
    });
  }

  if (scoreDelta >= 80) {
    return {
      status: 'recent_complete',
      label: `Estimated burst: +${Math.round(scoreDelta)}`,
      taskName,
      progressRatio: elapsedRatio,
      pendingPoints: remainingEstimate,
      timeToCompletionMs: null,
      lastCompletedTaskName: taskName,
      lastCompletedPoints: Math.round(scoreDelta),
      lastCompletedAgoMs: 0,
      isReplayBased: false,
      confidence: 'estimated',
      scoreDelta,
    };
  }

  if (elapsedRatio < 0.04) {
    return buildIdleState(player?.isGenerated ? 'Echo calibrating' : 'Warming up', {
      taskName,
      progressRatio: elapsedRatio,
      pendingPoints: remainingEstimate,
      confidence: 'estimated',
      scoreDelta,
    });
  }

  const status = remainingEstimate >= CHARGING_POINTS && elapsedRatio >= 0.62
    ? 'charging'
    : elapsedRatio >= 0.42
      ? 'deep_focus'
      : 'active';
  const label = status === 'charging'
    ? `Estimated push: ${taskName}`
    : status === 'deep_focus'
      ? `Estimated focus: ${taskName}`
      : `Estimated work: ${taskName}`;

  return {
    status,
    label,
    taskName,
    progressRatio: elapsedRatio,
    pendingPoints: remainingEstimate,
    timeToCompletionMs: remainingEstimate > 0 && toFiniteNumber(player?.pointsPerMs) > 0
      ? remainingEstimate / toFiniteNumber(player.pointsPerMs)
      : null,
    lastCompletedTaskName: null,
    lastCompletedPoints: 0,
    lastCompletedAgoMs: null,
    isReplayBased: false,
    confidence: 'estimated',
    scoreDelta,
  };
}

export function getPlayerActivityState(player, context = {}) {
  if (context.isCurrentPlayer) {
    return getCurrentPlayerActivity(context.activeTask, context);
  }
  if (player?.replayTrace?.sessions?.length) {
    return getReplayActivity(player, context);
  }
  return getEstimatedActivity(player, context);
}

export function getPlayerScoutingLabel(player) {
  if (!player) return 'Unknown profile';
  if (player.isCurrentPlayer) return 'Your live run';
  if (player.isGenerated) return 'Echo filler - estimated';

  const sessions = getReplaySessions(player);
  if (sessions.length) {
    const total = Math.max(0, Math.round(toFiniteNumber(player.replayTrace?.totalPoints)));
    const durationMs = Math.max(toFiniteNumber(player.replayTrace?.durationMs), 1);
    const maxSession = sessions.reduce((best, session) => (
      toFiniteNumber(session.points) > toFiniteNumber(best?.points) ? session : best
    ), null);
    const maxPoints = Math.max(0, Math.round(toFiniteNumber(maxSession?.points)));
    const hasLateThreat = sessions.some((session) => (
      toFiniteNumber(session.startOffset) / durationMs >= 0.62
      && toFiniteNumber(session.points) >= 120
    ));
    const avgDuration = sessions.reduce((sum, session) => (
      sum + Math.max(0, toFiniteNumber(session.endOffset) - toFiniteNumber(session.startOffset))
    ), 0) / sessions.length;

    if (maxPoints >= 220) return `Big-task threat - +${maxPoints}`;
    if (hasLateThreat) return 'Late-match threat';
    if (sessions.length >= 4 && total >= 260) return `Stable replay - ${total} pts`;
    if (avgDuration > 0 && avgDuration <= 18 * MINUTE && sessions.length >= 3) return 'Replay sprinter';
    return `Replay trace - ${total} pts`;
  }

  const estimatedTotal = Math.max(0, Math.round(toFiniteNumber(player.estimatedTotal)));
  if (estimatedTotal >= 420) return `High output estimate - ${estimatedTotal} pts`;
  if (estimatedTotal >= 220) return `Steady estimate - ${estimatedTotal} pts`;
  if (Array.isArray(player.recentTaskNames) && player.recentTaskNames.length) {
    return 'Recent-pattern estimate';
  }
  return 'Rank-rate estimate';
}
