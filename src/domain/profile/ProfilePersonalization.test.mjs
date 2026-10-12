import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { createServer } from 'vite';

const alias = (path) => fileURLToPath(new URL(path, import.meta.url));
const server = await createServer({
  root: alias('../..'),
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      '@domain': alias('../../domain'),
    },
  },
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});

test.after(async () => server.close());

const {
  normalizeProfilePersonalization,
} = await server.ssrLoadModule('/domain/profile/ProfilePersonalization.js');

test('explicit text blocks are preserved', () => {
  const normalized = normalizeProfilePersonalization({
    blocks: [
      { id: 'note', type: 'text', title: 'Note', content: 'Kept' },
    ],
  });

  assert.deepEqual(normalized.blocks.map((block) => block.type), ['text']);
});

test('profiles have no default Context block and legacy Context blocks are filtered', () => {
  assert.deepEqual(normalizeProfilePersonalization({}).blocks, []);
  assert.deepEqual(normalizeProfilePersonalization({ blocks: [{ type: 'lifeContext', id: 'old' }] }).blocks, []);
});

test('empty text block fields remain controlled empty values', () => {
  const normalized = normalizeProfilePersonalization({
    blocks: [
      { id: 'blank', type: 'text', title: '', content: '' },
    ],
  });

  assert.equal(normalized.blocks[0].title, '');
  assert.equal(normalized.blocks[0].content, '');
});
