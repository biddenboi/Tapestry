import assert from 'node:assert/strict';
import test from 'node:test';
import { SupabaseSyncBootstrap } from './SupabaseSyncBootstrap.js';
import { setRemoteResourceResolver } from '@shared/resources/Resources.js';

for (const hasWorkspace of [false, true]) {
  test(`mobile session ${hasWorkspace ? 'resumes cached data' : 'waits for clean-device restore'} before routine sync`, async (t) => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { search: '?mobile=1' } },
    });
    t.after(() => {
      setRemoteResourceResolver(null);
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
      else delete globalThis.window;
    });
    const scheduled = [];
    const runtime = {
      devices: { async getActive() { return null; } },
      setCheckpointPublishingEnabled(enabled) { assert.equal(enabled, false); },
      async configure({ schedule }) { assert.equal(schedule, false); },
      cancelScheduledSync() {},
      scheduleSync(reason) { scheduled.push(reason); },
    };
    const connection = {
      syncRuntime: runtime,
      async getAll() { return hasWorkspace ? [{ UUID: 'real-profile' }] : []; },
    };
    const authStates = [];
    const bootstrap = new SupabaseSyncBootstrap(connection, {
      client: { rpc() {}, channel() {} },
      auth: { setSyncState(state, error) { assert.ifError(error); authStates.push(state); } },
    });

    await bootstrap.applySession({ session: { user: { id: 'owner-1' } } });

    assert.equal(bootstrap.platform, 'mobile-web');
    assert.deepEqual(authStates, ['connecting', 'ready']);
    assert.deepEqual(scheduled, hasWorkspace ? ['supabase-session-configured'] : []);
  });
}
