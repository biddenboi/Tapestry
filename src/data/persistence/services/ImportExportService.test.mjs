import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportExportService } from './ImportExportService.js';

test('overlapping backup downloads share one build and failures allow a new attempt', async () => {
  const service = new ImportExportService({});
  let calls = 0;
  let finish;
  service._buildAndDownloadSave = () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  };
  const first = service.createCompactBackup();
  const second = service.getSaveAsZip();
  assert.equal(first, second);
  assert.equal(calls, 1);
  finish({ verified: true });
  assert.deepEqual(await first, { verified: true });
  service._buildAndDownloadSave = async () => { throw new Error('Storage unavailable'); };
  await assert.rejects(service.createCompactBackup(), /Storage unavailable/);
  service._buildAndDownloadSave = async () => ({ verified: true });
  assert.deepEqual(await service.createCompactBackup(), { verified: true });
});

test('backup preparation flushes local data and never requires or uploads a cloud snapshot', async () => {
  const actions = [];
  const service = new ImportExportService({
    ready: Promise.resolve(), compactWritePromise: Promise.resolve(),
    async ensureFullyLoaded() { actions.push('load'); },
    async flushWrites() { actions.push('flush'); },
    syncRuntime: { transport: {}, synchronize() { assert.fail('local backup must work offline'); },
      publishCloudCheckpoint() { assert.fail('no duplicate cloud backup'); } },
  });
  const result = await service._prepareDurableExport();
  assert.deepEqual(actions, ['load', 'flush']);
  assert.equal(result.localSqliteFlushed, true);
  assert.equal(result.cloudSynchronized, false);
});

test('manual and scheduled encrypted backups share one in-flight file write', async () => {
  const service = new ImportExportService({});
  let calls = 0;
  let finish;
  service._createEncryptedDesktopBackup = () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  };
  const scheduled = service.createEncryptedDesktopBackup();
  const manual = service.createEncryptedDesktopBackup();
  assert.equal(scheduled, manual);
  assert.equal(calls, 1);
  finish({ filename: 'one-backup.enc' });
  assert.deepEqual(await manual, { filename: 'one-backup.enc' });
});
