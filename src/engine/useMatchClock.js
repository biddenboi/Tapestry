/**
 * Match clock hook.
 *
 * Fires a `onTick(matchElapsedMs, wallDeltaMs)` callback once per second of
 * real time, but only while the match is in a live phase. The mode descriptor
 * supplies `isLivePhase(phaseId) => boolean`. Everything downstream (bomb
 * expiry, playback unlock, half-end detection) references the returned
 * `matchElapsedMs` — the single source of truth called out in the spec.
 *
 * The hook never persists on its own. It drives mutations through the
 * callback; the caller is responsible for writing match state back.
 */

import { useEffect, useRef } from 'react';

const TICK_MS = 1000;

export function useMatchClock({ phase, isLivePhase, onTick }) {
  // liveRef carries the latest onTick without retriggering the interval —
  // same escape-hatch pattern the existing conquest loop uses.
  const liveRef = useRef({ onTick, isLivePhase });
  liveRef.current = { onTick, isLivePhase };

  useEffect(() => {
    const live = liveRef.current;
    if (!live.isLivePhase || !live.isLivePhase(phase)) return undefined;

    let lastWall = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const delta = now - lastWall;
      lastWall = now;
      // Intentionally unreactive — reads from liveRef; see engine design notes.
      liveRef.current.onTick?.(delta);
    }, TICK_MS);

    return () => clearInterval(id);
  }, [phase]);
}
