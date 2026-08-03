const RECOVERY_KEY = 'tapestry:dynamic-resource-recovery';
const DEFAULT_COOLDOWN_MS = 15_000;
const DYNAMIC_RESOURCE_FAILURE = /(?:unable to preload css|failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|chunkloaderror|loading css chunk)/i;

function errorMessage(value) {
  if (typeof value === 'string') return value;
  if (value?.message) return String(value.message);
  return String(value || '');
}

export function isDynamicResourceLoadError(value) {
  return DYNAMIC_RESOURCE_FAILURE.test(errorMessage(value));
}

export function installDynamicResourceRecovery({
  windowRef = globalThis.window,
  now = Date.now,
  cooldownMs = DEFAULT_COOLDOWN_MS,
} = {}) {
  if (!windowRef?.addEventListener) return () => {};
  let recovering = false;

  const recover = (event, error, force = false) => {
    if (!force && !isDynamicResourceLoadError(error)) return false;
    event?.preventDefault?.();
    if (recovering) return true;

    const timestamp = Number(now()) || 0;
    let lastRecovery = 0;
    try {
      lastRecovery = Number(windowRef.sessionStorage?.getItem(RECOVERY_KEY)) || 0;
    } catch {
      lastRecovery = 0;
    }
    if (timestamp - lastRecovery < cooldownMs) return true;

    recovering = true;
    try {
      windowRef.sessionStorage?.setItem(RECOVERY_KEY, String(timestamp));
    } catch {
      // Reload recovery still works when session storage is unavailable.
    }
    windowRef.location?.reload?.();
    return true;
  };

  const onPreloadError = (event) => recover(event, event?.payload, true);
  const onUnhandledRejection = (event) => recover(event, event?.reason);
  const onError = (event) => recover(event, event?.error || event?.message);

  windowRef.addEventListener('vite:preloadError', onPreloadError);
  windowRef.addEventListener('unhandledrejection', onUnhandledRejection);
  windowRef.addEventListener('error', onError);

  return () => {
    windowRef.removeEventListener('vite:preloadError', onPreloadError);
    windowRef.removeEventListener('unhandledrejection', onUnhandledRejection);
    windowRef.removeEventListener('error', onError);
  };
}

export { RECOVERY_KEY as DYNAMIC_RESOURCE_RECOVERY_KEY };
