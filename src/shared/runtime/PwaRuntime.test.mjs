import assert from 'node:assert/strict';
import test from 'node:test';
import { registerTapestryServiceWorker } from './PwaRuntime.js';

test('development detaches service workers without reloading or registering', async () => {
  let unregisters = 0;
  let registrations = 0;
  let reloads = 0;
  const deleted = [];
  const windowRef = {
    location: {
      protocol: 'http:',
      hostname: 'localhost',
      reload() { reloads += 1; },
    },
    navigator: {
      serviceWorker: {
        controller: {},
        async getRegistrations() {
          return [{ async unregister() { unregisters += 1; } }];
        },
        async register() { registrations += 1; },
      },
    },
    caches: {
      async keys() { return ['tapestry-shell-v1', 'unrelated-cache']; },
      async delete(key) { deleted.push(key); return true; },
    },
  };

  await registerTapestryServiceWorker({ windowRef, production: false });

  assert.equal(unregisters, 1);
  assert.equal(registrations, 0);
  assert.equal(reloads, 0);
  assert.deepEqual(deleted, ['tapestry-shell-v1']);
});

test('production registers the worker without auto-reloading the open app', async () => {
  let registrations = 0;
  let reloads = 0;
  const windowRef = {
    location: {
      protocol: 'https:',
      hostname: 'tapestry.example',
      reload() { reloads += 1; },
    },
    document: { readyState: 'complete' },
    navigator: {
      serviceWorker: {
        controller: {},
        async register() { registrations += 1; return { scope: './' }; },
      },
    },
  };

  await registerTapestryServiceWorker({ windowRef, production: true });

  assert.equal(registrations, 1);
  assert.equal(reloads, 0);
});
