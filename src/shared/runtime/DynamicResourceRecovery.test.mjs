import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installDynamicResourceRecovery,
  isDynamicResourceLoadError,
} from './DynamicResourceRecovery.js';

test('recognizes Vite CSS and dynamic import failures without matching ordinary errors', () => {
  assert.equal(isDynamicResourceLoadError(new Error('Unable to preload CSS for /assets/tasks.css')), true);
  assert.equal(isDynamicResourceLoadError('Failed to fetch dynamically imported module'), true);
  assert.equal(isDynamicResourceLoadError(new Error('Task validation failed')), false);
});

test('preload recovery prevents the stale error and reloads only once per installation', () => {
  const listeners = new Map();
  const stored = new Map();
  let reloads = 0;
  let prevented = 0;
  const windowRef = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
    location: { reload: () => { reloads += 1; } },
    sessionStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
    },
  };
  const uninstall = installDynamicResourceRecovery({ windowRef, now: () => 100_000 });
  const event = {
    payload: new Error('Unable to preload CSS'),
    preventDefault: () => { prevented += 1; },
  };

  listeners.get('vite:preloadError')(event);
  listeners.get('vite:preloadError')(event);

  assert.equal(reloads, 1);
  assert.equal(prevented, 2);
  uninstall();
  assert.equal(listeners.size, 0);
});

test('ordinary unhandled rejections are left alone', () => {
  const listeners = new Map();
  let reloads = 0;
  let prevented = false;
  const windowRef = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: () => {},
    location: { reload: () => { reloads += 1; } },
    sessionStorage: { getItem: () => null, setItem: () => {} },
  };
  installDynamicResourceRecovery({ windowRef, now: () => 100_000 });
  listeners.get('unhandledrejection')({
    reason: new Error('Task validation failed'),
    preventDefault: () => { prevented = true; },
  });
  assert.equal(reloads, 0);
  assert.equal(prevented, false);
});
