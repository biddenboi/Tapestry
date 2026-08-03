import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { traversalDirection } from './SectionTraversal.js';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('section traversal preserves forward, backward, and replacement direction', () => {
  assert.equal(traversalDirection(0, 1), 'forward');
  assert.equal(traversalDirection(4, 2), 'backward');
  assert.equal(traversalDirection(2, 2), 'replace');
  assert.equal(traversalDirection(undefined, 2), 'replace');
});

test('every canonical motion pack has an explicit traversal signature', async () => {
  const css = await read('../styles/traversal.css');
  const motionPacks = [
    'precise', 'crisp', 'spring', 'drift', 'stepped', 'composed', 'snap',
    'dock', 'reward', 'growth', 'bubble', 'draft', 'cinematic', 'orbit',
    'handmade', 'recollection', 'gather',
  ];
  for (const motionPack of motionPacks) {
    assert.match(css, new RegExp(`data-theme-motion=["']${motionPack}["']`));
  }
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\[data-reduced-motion\]/);
});

test('panel, local tab, and section-tab navigation all announce traversal', async () => {
  const [gameHub, localNav, sectionTabs, main] = await Promise.all([
    read('../../app/shell/GameHub/GameHub.jsx'),
    read('../navigation/LocalSectionNav/LocalSectionNav.jsx'),
    read('../ui/SectionTabs.jsx'),
    read('../../main.jsx'),
  ]);
  assert.match(gameHub, /data-traversal-surface/);
  assert.match(gameHub, /data-traversal-page/);
  assert.match(localNav, /announceSectionTraversal/);
  assert.match(localNav, /local-section-nav__indicator/);
  assert.match(sectionTabs, /announceSectionTraversal/);
  assert.match(main, /shared\/styles\/traversal\.css/);
});

