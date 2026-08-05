function isLocalDevelopmentOrigin(windowRef) {
  const hostname = String(windowRef?.location?.hostname || '').trim().toLowerCase();
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

async function removeDevelopmentServiceWorkers(windowRef) {
  const serviceWorker = windowRef?.navigator?.serviceWorker;
  if (!serviceWorker) return null;

  try {
    const registrations = await serviceWorker.getRegistrations?.() || [];
    await Promise.all(registrations.map((registration) => registration.unregister()));

    // A previously installed production worker may have cached the dev shell.
    // Remove only Tapestry-named caches; unrelated origin caches are preserved.
    if (windowRef.caches?.keys) {
      const keys = await windowRef.caches.keys();
      await Promise.all(
        keys
          .filter((key) => /tapestry/i.test(String(key)))
          .map((key) => windowRef.caches.delete(key)),
      );
    }
  } catch (error) {
    console.warn('[Tapestry] Unable to detach the development service worker.', error);
  }

  // Do not reload here. Closing and reopening the dev window detaches any
  // controller that was already active without creating a reload loop.
  return null;
}

export function registerTapestryServiceWorker({
  windowRef = typeof window === 'undefined' ? null : window,
  production = Boolean(import.meta.env?.PROD),
} = {}) {
  if (!windowRef?.navigator?.serviceWorker) return Promise.resolve(null);
  if (!['http:', 'https:'].includes(windowRef.location?.protocol)) return Promise.resolve(null);

  if (!production || isLocalDevelopmentOrigin(windowRef)) {
    return removeDevelopmentServiceWorkers(windowRef);
  }

  const register = () => windowRef.navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
    .catch((error) => {
      console.warn('[Tapestry] Offline shell registration failed.', error);
      return null;
    });

  if (windowRef.document?.readyState === 'complete') return register();
  return new Promise((resolve) => {
    windowRef.addEventListener('load', () => void register().then(resolve), { once: true });
  });
}

export async function ensureTapestryServiceWorker({
  windowRef = typeof window === 'undefined' ? null : window,
} = {}) {
  const serviceWorker = windowRef?.navigator?.serviceWorker;
  if (!serviceWorker || !['http:', 'https:'].includes(windowRef.location?.protocol)) return null;
  const existing = await serviceWorker.getRegistration?.('/');
  const registration = existing || await serviceWorker.register('/service-worker.js', { scope: '/' });
  if (registration?.pushManager) return registration;
  const ready = await serviceWorker.ready;
  return ready || registration;
}

export default registerTapestryServiceWorker;
