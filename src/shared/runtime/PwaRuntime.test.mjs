import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the installable shell has offline navigation fallback and stable icons', async () => {
  const [manifestText, worker, html] = await Promise.all([
    readFile(new URL('../../../public/manifest.webmanifest', import.meta.url), 'utf8'),
    readFile(new URL('../../../public/service-worker.js', import.meta.url), 'utf8'),
    readFile(new URL('../../../index.html', import.meta.url), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, '/tapestry');
  assert.deepEqual(manifest.icons.map(({ sizes }) => sizes), ['192x192', '512x512']);
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(worker, /shellFallback/);
  assert.match(worker, /tapestry-icon-192\.png/);
  assert.match(worker, /tapestry-icon-512\.png/);
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-mobile-web-app-capable/);
});
