import { useEffect, useRef } from 'react';

export function useInterval(
  callback,
  delay,
  { pauseWhenHidden = true, runOnVisible = true } = {},
) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay == null) return undefined;
    let id = null;

    const clear = () => {
      if (id != null) window.clearInterval(id);
      id = null;
    };
    const start = () => {
      clear();
      if (pauseWhenHidden && document.hidden) return;
      id = window.setInterval(() => savedCallback.current?.(), delay);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clear();
        return;
      }
      if (runOnVisible) savedCallback.current?.();
      start();
    };

    start();
    if (pauseWhenHidden) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      clear();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [delay, pauseWhenHidden, runOnVisible]);
}
