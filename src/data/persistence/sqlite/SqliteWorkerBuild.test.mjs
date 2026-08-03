import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('./SqliteWorkerClient.js', import.meta.url);

test('SQLite worker construction stays in Vite static module-worker form', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(
    source,
    /new Worker\(new URL\('\.\/sqlite\.worker\.js', import\.meta\.url\),\s*\{\s*type: 'module'/s,
  );
  assert.doesNotMatch(source, /const\s+DEFAULT_WORKER_URL\s*=\s*new URL/);
});
