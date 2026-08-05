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

test('preload recovery reports one explicit error without reloading the application', () => {
  const listeners = new Map();
  const stored = new Map();
  let reloads = 0;
  let prevented = 0;
  const reported = [];
  const windowRef = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
    location: { reload: () => { reloads += 1; } },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init?.detail; }
    },
    dispatchEvent: (event) => reported.push(event),
    console: { error: () => {} },
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

  assert.equal(reloads, 0);
  assert.equal(prevented, 2);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].type, 'tapestry:dynamic-resource-error');
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
