function finiteMs(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function taskSessionElapsed(state, nowMs = Date.now()) {
  if (!state) return 0;
  const startedAtMs = finiteMs(state.startedAtMs, finiteMs(nowMs));
  const endBoundaryMs = state.pausedAtMs == null
    ? finiteMs(nowMs, startedAtMs)
    : finiteMs(state.pausedAtMs, startedAtMs);
  return Math.max(0, endBoundaryMs - startedAtMs - Math.max(0, finiteMs(state.pausedTotalMs)));
}

export function pauseTaskSession(state, nowMs = Date.now()) {
  if (!state || state.pausedAtMs != null) return state;
  return { ...state, pausedAtMs: finiteMs(nowMs, state.startedAtMs) };
}

export function resumeTaskSession(state, nowMs = Date.now()) {
  if (!state || state.pausedAtMs == null) return state;
  const resumedAtMs = finiteMs(nowMs, state.pausedAtMs);
  return {
    ...state,
    pausedAtMs: null,
    pausedTotalMs: Math.max(0, finiteMs(state.pausedTotalMs))
      + Math.max(0, resumedAtMs - finiteMs(state.pausedAtMs, resumedAtMs)),
  };
}

export function buildTaskSessionSnapshot(state, nowMs = Date.now()) {
  if (!state) return null;
  const elapsedMs = taskSessionElapsed(state, nowMs);
  const committedMs = Math.max(0, finiteMs(state.committedMs));
  const commitmentMet = committedMs > 0 && elapsedMs >= committedMs;
  return {
    ...state,
    elapsedMs,
    commitmentMet,
    progressRatio: committedMs > 0 ? Math.min(1, elapsedMs / committedMs) : 0,
    timerDisplayMs: committedMs > 0 && !commitmentMet
      ? Math.max(0, committedMs - elapsedMs)
      : elapsedMs,
    timerModeLabel: committedMs > 0 && !commitmentMet
      ? 'Time remaining'
      : commitmentMet
        ? 'Overtime'
        : 'Elapsed',
  };
}

export default taskSessionElapsed;
