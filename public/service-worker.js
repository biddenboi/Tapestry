const SHELL_CACHE = 'tapestry-shell-v9';
const ASSET_CACHE = 'tapestry-assets-v9';
const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './tapestry-icon.svg',
  './tapestry-icon-192.png',
  './tapestry-icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('tapestry-') && ![SHELL_CACHE, ASSET_CACHE].includes(key))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function shellFallback() {
  return caches.match('./index.html').then((response) => response || caches.match('./'));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(shellFallback),
    );
    return;
  }

  const versionedAsset = url.pathname.includes('/assets/')
    || /\.(?:js|css|wasm|png|svg|webp|woff2?)$/i.test(url.pathname);
  if (!versionedAsset) return;
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});

function pushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { body: event.data.text() };
  }
}

self.addEventListener('push', (event) => {
  const payload = pushPayload(event);
  const count = Math.max(0, Number(payload.badgeCount || 0));
  const options = {
    body: payload.body || 'An update is ready in Tapestry.',
    icon: './tapestry-icon-192.png',
    badge: './tapestry-icon-192.png',
    tag: payload.tag || 'tapestry-due-state',
    renotify: false,
    data: {
      url: payload.url || './?mobile=1',
      entityType: payload.entityType || null,
      entityId: payload.entityId || null,
    },
  };
  event.waitUntil(Promise.all([
    self.registration.showNotification(payload.title || 'Tapestry', options),
    count > 0 ? self.registration.setAppBadge?.(count) : self.registration.clearAppBadge?.(),
  ].filter(Boolean)));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './?mobile=1', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate?.(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});
