export function registerTapestryServiceWorker({ windowRef = typeof window === 'undefined' ? null : window } = {}) {
  if (!windowRef?.navigator?.serviceWorker) return Promise.resolve(null);
  if (!['http:', 'https:'].includes(windowRef.location?.protocol)) return Promise.resolve(null);
  const hadController = Boolean(windowRef.navigator.serviceWorker.controller);
  let refreshing = false;
  if (hadController) {
    windowRef.navigator.serviceWorker.addEventListener?.('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      windowRef.location.reload();
    }, { once: true });
  }
  const register = () => windowRef.navigator.serviceWorker.register('./service-worker.js', { scope: './' })
    .catch((error) => {
      console.warn('[Tapestry] Offline shell registration failed.', error);
      return null;
    });
  if (windowRef.document?.readyState === 'complete') return register();
  return new Promise((resolve) => {
    windowRef.addEventListener('load', () => void register().then(resolve), { once: true });
  });
}

export default registerTapestryServiceWorker;
