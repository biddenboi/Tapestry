import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDocumentRepository from './SqliteDocumentRepository.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const PROFILE_ID = 'player-profile-resource-test';
const RESOURCE_ID = 'profile-resource-test';
const SECOND_RESOURCE_ID = 'profile-resource-test-copy';
const JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0xff, 0xd9,
]);

function resourceRecord(UUID) {
  return {
    UUID,
    parent: PROFILE_ID,
    kind: 'profilePicture',
    mimeType: 'image/jpeg',
    blob: new Blob([JPEG_BYTES], { type: 'image/jpeg' }),
    createdAt: '2026-07-17T12:00:00.000Z',
  };
}

test('compact profile resources retain binary bytes across repository reload', async (t) => {
  const context = await createShadowTestContext();
  t.after(context.close);
  const repository = new SqliteDocumentRepository(context.client);

  await repository.put('resources', resourceRecord(RESOURCE_ID), {
    operationId: 'compact-profile-resource-write',
  });
  await repository.put('players', {
    UUID: PROFILE_ID,
    username: 'Sophia',
    profilePicture: { type: 'resource', resourceUUID: RESOURCE_ID },
  }, {
    operationId: 'compact-profile-write',
  });

  const storedJson = await context.client.query({
    sql: 'SELECT record_json FROM document_resources WHERE uuid=?',
    bind: [RESOURCE_ID],
    result: 'value',
  });
  assert.doesNotMatch(storedJson, /"blob"|"dataUrl"|"bytes"/);
  assert.equal(await context.client.query({
    sql: 'SELECT COUNT(*) FROM document_resource_payloads',
    result: 'value',
  }), 1);

  const reopenedRepository = new SqliteDocumentRepository(context.client);
  const player = await reopenedRepository.get('players', PROFILE_ID);
  const resource = await reopenedRepository.get('resources', player.profilePicture.resourceUUID);
  assert.ok(resource.blob instanceof Blob);
  assert.equal(resource.blob.type, 'image/jpeg');
  assert.deepEqual(
    new Uint8Array(await resource.blob.arrayBuffer()),
    JPEG_BYTES,
  );
});

test('compact resource payloads deduplicate by hash and clean up after their final UUID is removed', async (t) => {
  const context = await createShadowTestContext();
  t.after(context.close);
  const repository = new SqliteDocumentRepository(context.client);

  await repository.put('resources', resourceRecord(RESOURCE_ID), {
    operationId: 'compact-resource-dedup-first',
  });
  await repository.put('resources', resourceRecord(SECOND_RESOURCE_ID), {
    operationId: 'compact-resource-dedup-second',
  });

  assert.equal(await context.client.query({
    sql: 'SELECT COUNT(*) FROM document_resource_payloads',
    result: 'value',
  }), 1);
  assert.equal(await context.client.query({
    sql: 'SELECT COUNT(*) FROM document_resource_payload_refs',
    result: 'value',
  }), 2);

  await repository.remove('resources', RESOURCE_ID, {
    operationId: 'compact-resource-remove-first',
  });
  assert.equal(await context.client.query({
    sql: 'SELECT COUNT(*) FROM document_resource_payloads',
    result: 'value',
  }), 1);

  await repository.remove('resources', SECOND_RESOURCE_ID, {
    operationId: 'compact-resource-remove-second',
  });
  assert.equal(await context.client.query({
    sql: 'SELECT COUNT(*) FROM document_resource_payloads',
    result: 'value',
  }), 0);
});
