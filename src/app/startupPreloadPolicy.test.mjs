import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');
const [app, gameHub, panelRegistry, playerSession] = await Promise.all([
  read('./App.jsx'),
  read('./shell/GameHub/GameHub.jsx'),
  read('./shell/GameHub/panelRegistry.js'),
  read('./hooks/useCurrentPlayerSession.js'),
]);

test('startup does not globally preload the task recommender', () => {
  assert.doesNotMatch(app, /import\(['"]@domain\/tasks\/TaskRecommender\.js['"]\)/);
  assert.doesNotMatch(app, /task recommender preload/i);
});

test('idle panel and retired Quick Notes preload queues are absent', () => {
  assert.doesNotMatch(gameHub, /CRITICAL_PRELOADERS|PANEL_PRELOADERS/);
  assert.doesNotMatch(gameHub, /critical preload failed|\bwarm\s*=|4200/);
  assert.doesNotMatch(gameHub, /loadQuickNotes|showQuickNotes|Quick Notes/);
  assert.match(gameHub, /<QuickCaptureLauncher \/>/);
});

test('secondary domains are no longer prepared by the player-session startup hook', () => {
  assert.doesNotMatch(playerSession, /syncContributionPassRewards|pruneFutureDayEvents/);
  assert.doesNotMatch(playerSession, /requestIdleCallback|scheduleBackgroundJob/);
});

test('feature panels remain dynamic imports', () => {
  for (const feature of ['Lobby', 'TodoList', 'Events', 'Feed', 'SocialWorldShell']) {
    assert.match(panelRegistry, new RegExp(`import\\([^)]*${feature}`));
  }
});
