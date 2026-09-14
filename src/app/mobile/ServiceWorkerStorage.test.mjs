import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { stampServiceWorker } from '../../../scripts/stamp-service-worker.mjs';

test('each changed build gets its own cache identity, stable builds reuse it', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tapestry-sw-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await readFile(new URL('../../../public/service-worker.js', import.meta.url), 'utf8');
  const build = async (html) => {
    await writeFile(join(directory, 'index.html'), html);
    await writeFile(join(directory, 'service-worker.js'), source);
    stampServiceWorker(directory);
    return readFile(join(directory, 'service-worker.js'), 'utf8');
  };
  const first = await build('<script src="/assets/first.js"></script>');
  assert.equal(await build('<script src="/assets/first.js"></script>'), first);
  assert.notEqual(await build('<script src="/assets/second.js"></script>'), first);
  assert.ok(!first.includes('__TAPESTRY_BUILD_ID__'));
});

test('activation retires old app code caches and leaves other storage alone', async () => {
  const source = (await readFile(new URL('../../../public/service-worker.js', import.meta.url), 'utf8'))
    .replaceAll('__TAPESTRY_BUILD_ID__', 'current');
  const handlers = new Map();
  const deleted = [];
  const names = ['tapestry-assets-v9', 'tapestry-shell-v9', 'tapestry-assets-v10-current',
    'tapestry-shell-v10-current', 'tapestry-user-backups', 'unrelated-cache'];
  vm.runInNewContext(source, {
    self: { addEventListener(name, handler) { handlers.set(name, handler); }, clients: { async claim() {} } },
    caches: { async keys() { return names; }, async delete(name) { deleted.push(name); } },
  });
  let work;
  handlers.get('activate')({ waitUntil(promise) { work = promise; } });
  await work;
  assert.deepEqual(deleted, ['tapestry-assets-v9', 'tapestry-shell-v9']);
});
