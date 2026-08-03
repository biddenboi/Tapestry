import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const { SocialWorldPresenceController: PresenceController } = await import('./controllers/SocialWorldPresenceController.js');
const [app, hook, controller, session, profile, profileController, runtime, core, migration] = await Promise.all([
  read('../../app/App.jsx'),
  read('./hooks/useSocialWorldPresenceLifecycle.js'),
  read('./controllers/SocialWorldPresenceController.js'),
  read('../tasks/context/TaskSessionProvider.jsx'),
  read('../profile/pages/Profile/Profile.jsx'),
  read('../profile/pages/Profile/ProfileDataController.js'),
  read('../../data/persistence/PersistenceRuntime.js'),
  read('../../data/persistence/sqlite/SqliteCoreProfileRepository.js'),
  read('../../data/persistence/sqlite/migrations/019_social_world_presence_cast.js'),
]);

test('app-level controller owns semantic transitions, Commons, and app-lifetime interruption listeners', () => {
  assert.match(app, /useSocialWorldPresenceLifecycle\(\{/);
  assert.match(controller, /resolveSemanticLocation\(\{/);
  assert.match(hook, /pagehide/);
  assert.match(hook, /pageshow/);
  assert.doesNotMatch(hook, /visibilitychange|document\.hidden|appBackground/);
  assert.doesNotMatch(hook, /worldVisible/);
  assert.doesNotMatch(hook, /setInterval|useInterval/);
});

test('Task Session pause, resume, and completion use the presence service', () => {
  assert.match(session, /pauseSocialWorldPresence\(presenceCommand\)/);
  assert.match(session, /resumeSocialWorldPresence\(presenceCommand\)/);
  assert.match(session, /closeCompletedTaskSessionPresence\(\{/);
});

test('Profile consumes a prepared presence projection rather than deriving elapsed time', () => {
  assert.match(profileController, /getSocialWorldPresence\(\{/);
  assert.match(profile, /<ProfilePresenceSummary presence=\{presence\}/);
  assert.doesNotMatch(profile, /activeElapsedMs\s*\+/);
});

test('SQLite owns interval facts and profile switching is coordinated atomically', () => {
  assert.match(migration, /semantic_presence_intervals/);
  assert.match(migration, /semantic_presence_one_open_per_player_idx/);
  assert.match(runtime, /SocialWorldPresenceService/);
  assert.match(core, /socialWorldProfileSwitch\.switchProfile\(options\)/);
});

test('a failed semantic transition remains retryable without allowing concurrent duplicates', async () => {
  let attempts = 0;
  let releaseFirst;
  const firstAttempt = new Promise((resolve, reject) => { releaseFirst = () => reject(new Error('write-failed')); });
  const gateway = {
    transitionSocialWorldPresence: async () => {
      attempts += 1;
      if (attempts === 1) return firstAttempt;
      return { status: 'opened' };
    },
  };
  const controllerInstance = new PresenceController({ gateway, idFactory: () => 'stable-test-command' });
  const facts = {
    playerId: 'p1',
    viewerIGT: 30,
    gameState: 'idle',
    activeTask: { UUID: 'task-1', createdAt: '2026-07-14T00:00:00.000Z' },
  };
  const pending = controllerInstance.synchronize(facts);
  const queuedRetry = controllerInstance.synchronize(facts);
  releaseFirst();
  await assert.rejects(pending, /write-failed/);
  assert.equal((await queuedRetry).status, 'opened');
  assert.equal(attempts, 2);
});

test('closing Tasks cannot let an older Planning write replace the newer Commons state', async () => {
  const transitions = [];
  let persistedLocation = null;
  let releasePlanning;
  const gateway = {
    transitionSocialWorldPresence: async ({ location }) => {
      transitions.push(location);
      if (location === 'planning') {
        return new Promise((resolve) => {
          releasePlanning = () => {
            persistedLocation = location;
            resolve({
              interval: { id: 'planning-interval', location: 'planning', activeAnchorAt: null },
            });
          };
        });
      }
      persistedLocation = location;
      return {
        interval: { id: 'commons-interval', location: 'commons', activeAnchorAt: null },
      };
    },
  };
  const controllerInstance = new PresenceController({ gateway });
  const planning = controllerInstance.synchronize({
    playerId: 'p1',
    viewerIGT: 30,
    gameState: 'idle',
    activePanel: 'tasks',
  });
  await new Promise((resolve) => setImmediate(resolve));
  const commons = controllerInstance.synchronize({
    playerId: 'p1',
    viewerIGT: 31,
    gameState: 'idle',
    activePanel: null,
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(transitions, ['planning']);
  releasePlanning();
  await Promise.all([planning, commons]);
  assert.deepEqual(transitions, ['planning', 'commons']);
  assert.equal(persistedLocation, 'commons');
  assert.match(controllerInstance.lastTransitionKey, /:commons:/);
});

test('opening ordinary panels keeps the player in Commons while updating exact panel presence', async () => {
  const transitions = [];
  let closes = 0;
  const gateway = {
    transitionSocialWorldPresence: async ({ location }) => {
      transitions.push(location);
      return {
        interval: { id: `${location}-interval`, location, activeAnchorAt: null },
      };
    },
    closeSocialWorldPresence: async () => {
      closes += 1;
      return { status: 'closed' };
    },
  };
  const controllerInstance = new PresenceController({ gateway });

  await controllerInstance.synchronize({
    playerId: 'p1',
    viewerIGT: 40,
    gameState: 'idle',
    activePanel: null,
  });
  for (const activePanel of ['feed', 'events', 'inventory', 'pass', 'profile']) {
    await controllerInstance.synchronize({
      playerId: 'p1',
      viewerIGT: 41,
      gameState: 'idle',
      activePanel,
    });
  }

  assert.deepEqual(transitions, ['commons', 'commons', 'commons', 'commons', 'commons', 'commons']);
  assert.equal(closes, 0);
  assert.match(controllerInstance.lastTransitionKey, /:commons:panel:profile$/);
});
