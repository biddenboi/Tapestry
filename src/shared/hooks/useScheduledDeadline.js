import { useEffect, useRef } from 'react';
import { getScheduledDelay } from '@app/shell/GameHub/panelScheduling.js';

export function useScheduledDeadline(
  callback,
  deadline,
  { enabled = true, runWhenVisible = true } = {},
) {
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; }, [callback]);

  useEffect(() => {
    if (!enabled || !Number.isFinite(deadline)) return undefined;
    let timer = null;
    let cancelled = false;

    const clear = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      clear();
      if (cancelled || (runWhenVisible && document.hidden)) return;
      const delay = getScheduledDelay(deadline);
      if (delay == null) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (cancelled) return;
        if (Date.now() + 4 < deadline) {
          schedule();
          return;
        }
        callbackRef.current?.();
      }, delay);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clear();
      } else {
        schedule();
      }
    };

    schedule();
    if (runWhenVisible) document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      clear();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [deadline, enabled, runWhenVisible]);
}
