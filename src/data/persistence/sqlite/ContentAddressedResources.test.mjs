import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryResourceFileAdapter } from '../resources/ResourceFileAdapters.js';
import { sha256Bytes } from '../resources/ResourceOperationService.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const pngA = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4,5]);
const pngB = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,9,8,7,6,5]);
const fixed = new Date('2026-07-12T21:00:00.000Z');

async function setup(now = () => fixed) {
  const context = await createShadowTestContext({ now });
  const files = new MemoryResourceFileAdapter();
  return { context, files, service: context.shadow.createResourceOperations(files) };
}

test('Batch 17 deduplicates bytes while retaining independent ownership references', async (t) => {
  const { context, files, service } = await setup();
  t.after(context.close);
  const first = await service.promote(pngA, {
    operationId: 'resource-a', ownerType: 'journal', ownerId: 'j1', role: 'image:0', declaredMime: 'image/png',
  });
  const second = await service.promote(pngA, {
    operationId: 'resource-b', ownerType: 'profile', ownerId: 'p1', role: 'avatar', declaredMime: 'image/png',
  });
  assert.equal(first.status, 'indexed');
  assert.equal(second.status, 'indexed');
  assert.equal(second.duplicateBytes, true);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM resources WHERE state='active'", result: 'value' }), 1);
  assert.equal(await context.client.query({ sql: 'SELECT COUNT(*) FROM resource_references WHERE deleted_at IS NULL', result: 'value' }), 2);
  assert.equal((await files.list('resources/')).filter((path) => !path.includes('/.')).length, 1);
  assert.equal((await sha256Bytes(await files.readBytes(first.resource.storagePath))), first.resource.contentHash);
});

for (const phase of ['after-prepare','after-file-publish','after-published-state','after-index']) {
  test(`Batch 17 recovers a resource promotion interrupted at ${phase}`, async (t) => {
    const { context, files } = await setup();
    t.after(context.close);
    let injected = false;
    const crashing = context.shadow.createResourceOperations(files, {
      phaseHook: (name) => {
        if (!injected && name === phase) {
          injected = true;
          throw new Error(`crash:${phase}`);
        }
      },
    });
    await assert.rejects(crashing.promote(pngA, {
      operationId: `promote-${phase}`, ownerType: 'journal', ownerId: 'j1', role: `image:${phase}`,
    }), new RegExp(`crash:${phase}`));
    const recovery = context.shadow.createResourceOperations(files);
    const report = await recovery.reconcile();
    const resumed = await recovery.promote(pngA, {
      operationId: `promote-${phase}`, ownerType: 'journal', ownerId: 'j1', role: `image:${phase}`,
    });
    assert.equal(resumed.status, 'indexed');
    assert.equal((await recovery.listReferences(resumed.operation.resourceHash)).length, 1);
    assert.equal((await recovery.reconcile()).resumed.length, 0);
    if (phase !== 'after-index') assert.ok(report.resumed.some((row) => row.status === 'indexed'));
  });
}

test('Batch 17 safely retries a crash after stage write but before the durable intent', async (t) => {
  const { context, files } = await setup();
  t.after(context.close);
  let injected = false;
  const crashing = context.shadow.createResourceOperations(files, {
    phaseHook: (name) => {
      if (!injected && name === 'after-stage-write') { injected = true; throw new Error('crash:stage'); }
    },
  });
  await assert.rejects(crashing.promote(pngB, {
    operationId: 'stage-crash', ownerType: 'event', ownerId: 'e1', role: 'banner',
  }), /crash:stage/);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM resource_file_ops WHERE operation_id='stage-crash'", result: 'value' }), 0);
  const result = await context.shadow.createResourceOperations(files).promote(pngB, {
    operationId: 'stage-crash', ownerType: 'event', ownerId: 'e1', role: 'banner',
  });
  assert.equal(result.status, 'indexed');
});

test('Batch 17 quarantines signature/MIME disagreement and never creates a live reference', async (t) => {
  const { context, files, service } = await setup();
  t.after(context.close);
  const result = await service.promote(pngA, {
    operationId: 'bad-mime', ownerType: 'event', ownerId: 'e1', role: 'banner', declaredMime: 'image/jpeg',
  });
  assert.equal(result.status, 'quarantined');
  assert.equal(result.operation.errorCode, 'resource-mime-mismatch');
  assert.equal(result.resource.state, 'quarantined');
  assert.equal(await context.client.query({ sql: 'SELECT COUNT(*) FROM resource_references', result: 'value' }), 0);
  assert.ok((await files.list()).some((path) => path.includes('/.quarantine/')));
  assert.ok((await service.listOpenIssues()).some((issue) => issue.issueType === 'resource-mime-mismatch'));
});

test('Batch 17 backup-aware mark-and-sweep preserves live, pending, quarantined, and pinned bytes', async (t) => {
  let clock = new Date('2026-07-12T21:00:00.000Z');
  const { context, files, service } = await setup(() => new Date(clock));
  t.after(context.close);
  const live = await service.promote(pngA, { operationId: 'gc-live', ownerType: 'profile', ownerId: 'p1', role: 'avatar' });
  const doomed = await service.promote(pngB, { operationId: 'gc-doomed', ownerType: 'event', ownerId: 'e1', role: 'banner' });
  await service.pinBackup('backup-1', [doomed.resource.contentHash], { retainedUntil: '2026-09-01T00:00:00.000Z' });
  await service.dereference({ operationId: 'gc-deref', ownerType: 'event', ownerId: 'e1', role: 'banner' });
  await service.promote(pngA, { operationId: 'gc-quarantine', ownerType: 'event', ownerId: 'bad', role: 'bad', declaredMime: 'image/jpeg' });

  let pendingInjected = false;
  const pendingService = context.shadow.createResourceOperations(files, {
    phaseHook: (phase) => { if (!pendingInjected && phase === 'after-prepare') { pendingInjected = true; throw new Error('pending'); } },
  });
  await assert.rejects(pendingService.promote(Uint8Array.from([...pngB, 0xaa]), {
    operationId: 'gc-pending', ownerType: 'event', ownerId: 'pending', role: 'banner',
  }), /pending/);

  clock = new Date('2026-08-20T00:00:00.000Z');
  assert.equal((await service.markAndSweep()).removed.length, 0);
  assert.ok(await files.readBytes(doomed.resource.storagePath));
  assert.ok(await files.readBytes(live.resource.storagePath));
  assert.ok((await files.list()).some((path) => path.includes('/.quarantine/')));
  assert.ok((await files.list()).some((path) => path.includes('/.staging/')));

  clock = new Date('2026-09-02T00:00:00.000Z');
  const swept = await service.markAndSweep();
  assert.deepEqual(swept.removed.map((row) => row.resourceHash), [doomed.resource.contentHash]);
  assert.equal(await files.readBytes(doomed.resource.storagePath), null);
  assert.ok(await files.readBytes(live.resource.storagePath));
});

test('resource imports require canonical bytes and ownership', async (t) => {
  const { context, files } = await setup();
  t.after(context.close);
  const importer = context.shadow.createResourceImporter(files);
  const fixture = { resources: [
    { UUID: 'r1', ownerType: 'journal', ownerId: 'j1', role: 'image:0', referenceId: 'r1', mimeType: 'image/png', bytes: pngA },
    { UUID: 'r2', ownerType: 'event', ownerId: 'e1', role: 'banner', referenceId: 'r2', mimeType: 'image/png', bytes: pngA },
    { UUID: 'missing', ownerType: 'event', ownerId: 'e2', role: 'banner' },
  ] };
  const imported = await importer.import(fixture);
  assert.equal(imported.counts.references, 2);
  assert.equal(imported.counts.uniqueResources, 1);
  assert.equal(imported.counts.diagnostics, 1);
  assert.equal((await importer.import(fixture)).duplicate, true);
  const JSONRows = await context.client.query({
    sql: `SELECT metadata_json AS metadata FROM resources
          UNION ALL SELECT metadata_json FROM resource_references`, result: 'values',
  });
  assert.ok(JSONRows.every((value) => !String(value).includes('data:image')));
});
