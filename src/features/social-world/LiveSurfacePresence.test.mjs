import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const hook = await readFile(new URL('./hooks/useLiveViewerScene.js', import.meta.url), 'utf8');

test('the active viewer forwards ordinary panel identity into live presence', () => {
  assert.match(hook, /location === 'commons' && activePanel/);
  assert.match(hook, /sourceType: 'panel'/);
  assert.match(hook, /sourceId: activePanel/);
  assert.match(hook, /withLiveViewerPresence\(scene/);
});

test('feed is not silently converted into Planning or Marketplace', () => {
  assert.doesNotMatch(hook, /activePanel\s*===\s*['"]feed['"].*planning/s);
  assert.doesNotMatch(hook, /activePanel\s*===\s*['"]feed['"].*marketplace/s);
});

const controller = await readFile(new URL('./controllers/SocialWorldPresenceController.js', import.meta.url), 'utf8');

test('persisted Commons presence records Feed and other ordinary panels as its source', () => {
  assert.match(controller, /location === SEMANTIC_LOCATION\.commons && activePanel/);
  assert.match(controller, /return \{ sourceType: 'panel', sourceId: activePanel \}/);
});
