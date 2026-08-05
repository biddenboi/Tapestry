import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { registerDeviceWithTimeout } from './DeviceRegistrationGate.js';

test('device registration resolves normally before the deadline', async () => {
  const result = await registerDeviceWithTimeout({
    register: async () => ({ deviceId: 'device-1' }),
    timeoutMs: 50,
  });
  assert.deepEqual(result, {
    registered: true,
    result: { deviceId: 'device-1' },
  });
});

test('device registration rejects instead of leaving bootstrap connecting forever', async () => {
  await assert.rejects(
    registerDeviceWithTimeout({
      register: () => new Promise(() => undefined),
      timeoutMs: 10,
    }),
    (error) => error?.code === 'sync-device-registration-timeout',
  );
});

test('missing registration support is a no-op', async () => {
  assert.deepEqual(await registerDeviceWithTimeout(), {
    registered: false,
    reason: 'registration-not-required',
  });
});

test('SyncRuntime configures transport before bounded registration and gates every sync on it', async () => {
  const source = await readFile(new URL('./SyncRuntime.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /await this\.transport\.registerDevice\?\.\(this\.device\)/);
  assert.match(source, /this\.statusStore\.setTransportConfigured\(Boolean\(this\.transport\)\)/);
  assert.match(source, /await this\.ensureDeviceRegistered\(\);\s*\n\s*const uploaded = await this\._push/);
});
