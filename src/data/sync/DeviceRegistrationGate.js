export function registerDeviceWithTimeout({
  register,
  timeoutMs = 10_000,
  setTimeoutFn = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeoutFn = (timer) => globalThis.clearTimeout(timer),
  AbortControllerClass = globalThis.AbortController,
} = {}) {
  if (typeof register !== 'function') {
    return Promise.resolve({ registered: false, reason: 'registration-not-required' });
  }

  const boundedTimeoutMs = Math.max(1, Number(timeoutMs) || 10_000);
  const controller = typeof AbortControllerClass === 'function'
    ? new AbortControllerClass()
    : null;
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeoutFn(() => {
      const error = new Error('Private sync could not register this device before the request timed out.');
      error.code = 'sync-device-registration-timeout';
      reject(error);
      // Settle the public request with the explicit timeout error before the
      // transport observes cancellation. Otherwise an AbortError can win the
      // Promise.race and hide the actionable sync state from the UI.
      controller?.abort?.();
    }, boundedTimeoutMs);
  });
  const registration = Promise.resolve().then(() => register({ signal: controller?.signal || null }));

  return Promise.race([registration, timeout])
    .then((result) => ({ registered: true, result }))
    .finally(() => {
      if (timeoutId != null) clearTimeoutFn(timeoutId);
    });
}

export default registerDeviceWithTimeout;
