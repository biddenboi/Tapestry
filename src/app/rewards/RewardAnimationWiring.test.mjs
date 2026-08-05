import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('all issued achievements reach the global reward animation layer', async () => {
  const [processor, app, layer] = await Promise.all([
    read('../../domain/achievements/AchievementProcessing.js'),
    read('../App.jsx'),
    read('./RewardFloatLayer.jsx'),
  ]);

  assert.match(processor, /tapestry:achievement-earned/);
  assert.match(processor, /detail: \{ keys: \[\.\.\.keys\] \}/);
  assert.match(app, /addEventListener\('tapestry:achievement-earned'/);
  assert.match(app, /kind: 'achievement'/);
  assert.match(layer, /achievement: '✪'/);
});
