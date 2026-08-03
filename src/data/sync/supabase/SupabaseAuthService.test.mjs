import assert from 'node:assert/strict';
import test from 'node:test';
import { PRIMARY_OWNER_EMAIL, SupabaseAuthService } from './SupabaseAuthService.js';

function clientFixture({ session = null } = {}) {
  const calls = [];
  const client = {
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async signInWithPassword(input) {
        calls.push(['signInWithPassword', input]);
        return {
          data: {
            session: { access_token: 'access', user: { id: 'owner', email: input.email } },
            user: { id: 'owner', email: input.email },
          },
          error: null,
        };
      },
      async signInWithOAuth(input) {
        calls.push(['signInWithOAuth', input]);
        return { data: { provider: 'google', url: 'https://accounts.google.com/' }, error: null };
      },
      async updateUser(input) {
        calls.push(['updateUser', input]);
        return { data: { user: session?.user || { id: 'owner', email: PRIMARY_OWNER_EMAIL } }, error: null };
      },
    },
  };
  return { calls, client };
}

test('owner password sign-in avoids the email OTP endpoint', async () => {
  const { calls, client } = clientFixture();
  const service = new SupabaseAuthService({ client, configuration: { configured: true } });
  await service.initialize();
  await service.signInWithPassword(PRIMARY_OWNER_EMAIL, 'a private password');
  assert.deepEqual(calls, [[
    'signInWithPassword',
    { email: PRIMARY_OWNER_EMAIL, password: 'a private password' },
  ]]);
  assert.equal(service.getSnapshot().status, 'signed-in');
});

test('a signed-in owner can set a durable mobile password', async () => {
  const session = { access_token: 'desktop', user: { id: 'owner', email: PRIMARY_OWNER_EMAIL } };
  const { calls, client } = clientFixture({ session });
  const service = new SupabaseAuthService({ client, configuration: { configured: true } });
  await service.initialize();
  await service.setPassword('twelve-or-more-characters');
  assert.deepEqual(calls, [[
    'updateUser',
    { password: 'twelve-or-more-characters' },
  ]]);
  assert.match(service.getSnapshot().notice, /iPhone/);
});

test('Google owner sign-in starts OAuth without sending an email', async () => {
  const { calls, client } = clientFixture();
  const service = new SupabaseAuthService({ client, configuration: { configured: true } });
  await service.initialize();
  const result = await service.signInWithGoogle();
  assert.equal(result.provider, 'google');
  assert.deepEqual(calls, [[
    'signInWithOAuth',
    { provider: 'google', options: { redirectTo: undefined } },
  ]]);
});

test('new private-sync passwords require at least twelve characters', async () => {
  const session = { access_token: 'desktop', user: { id: 'owner', email: PRIMARY_OWNER_EMAIL } };
  const { client } = clientFixture({ session });
  const service = new SupabaseAuthService({ client, configuration: { configured: true } });
  await service.initialize();
  await assert.rejects(() => service.setPassword('too-short'), /at least 12/);
});

test('sync transport errors never contaminate the authentication error field', async () => {
  const session = { access_token: 'desktop', user: { id: 'owner', email: PRIMARY_OWNER_EMAIL } };
  const { client } = clientFixture({ session });
  const service = new SupabaseAuthService({ client, configuration: { configured: true } });
  await service.initialize();

  service.setSyncState('error', new Error('The mobile working-set publish session is no longer active.'));
  assert.equal(service.getSnapshot().error, null);
  assert.equal(service.getSnapshot().syncStatus, 'error');
  assert.equal(
    service.getSnapshot().syncError?.message,
    'The mobile working-set publish session is no longer active.',
  );

  service.setSyncState('ready');
  assert.equal(service.getSnapshot().error, null);
  assert.equal(service.getSnapshot().syncError, null);
});
