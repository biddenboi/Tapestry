import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [databaseSource, demoDataSource, timelineSource] = await Promise.all([
  readFile(new URL('../persistence/DatabaseConnectionHost.js', import.meta.url), 'utf8'),
  readFile(new URL('../persistence/services/DemoDataSeeder.js', import.meta.url), 'utf8'),
  readFile(new URL('../persistence/services/TimelineQueryService.js', import.meta.url), 'utf8'),
]);

test('demo data covers every major product surface and rebuilds derived views', () => {
  for (const marker of [
    'demo-todo-8',
    'demo-task-dojo-1',
    'demo-goal-archive',
    'demo-event-log-6',
    'demo-journal-rhea',
    'demo-reminder-snoozed',
    'demo-inventory-theme',
    'demo-transaction-cash-shop',
    'demo-contribution-3',
    'demo-match-close-win',
    'demo-friend-pending-in',
    'demo-notification-friend-request',
    'demo-note-3',
    'demo-rhea-goal',
    'demo-rhea-todo-2',
    'demo-rhea-social-update',
    'demo-presence-rhea-dojo',
    'demo-presence-mika-dojo',
    'demo-rhea-baseline-encounter',
    'achievement-state:',
  ]) {
    assert.match(demoDataSource, new RegExp(marker));
  }
  assert.match(demoDataSource, /buildProfileSummaries\(\{/);
  assert.match(demoDataSource, /shadow\.importers\.coreProfiles\.import\(\{/);
  assert.match(demoDataSource, /shadow\.importers\.planning\.import\(\{/);
  assert.match(demoDataSource, /shadow\.dojoStandings\.recordTaskCompletion\(\{ task \}\)/);
  assert.match(demoDataSource, /shadow\.dojoStandings\.materializeRanks\(\)/);
  assert.match(demoDataSource, /runtime\.socialEncounters\.recordEncounter\(\{/);
  assert.match(demoDataSource, /THEME_REGISTRY\.filter\(\(theme\) => !theme\.free\)/);
  assert.doesNotMatch(demoDataSource, /resident|occupancy|candidate gateway/i);
  assert.doesNotMatch(demoDataSource, /buildDojoLeaderboardSnapshot\(|DojoLeaderboardSnapshots/);
  assert.match(demoDataSource, /rebuildMaterializedLeaderboards\(this, \{ reason: 'demo-seed' \}\)/);
  assert.match(databaseSource, /loadDemoData\(\) \{ return this\.demoDataSeeder\.seed\(\); \}/);
});

test('demo mode is explicit and uses the in-memory SQLite adapter', () => {
  assert.match(`${databaseSource}\n${demoDataSource}`, /demoMode = false/);
  assert.match(demoDataSource, /adapter\.open\(\{ mode: 'memory' \}\)/);
});

test('time-scoped comment reads use the journal comment store and journal UUID index', () => {
  const method = timelineSource.match(
    /async getCommentsForJournalThroughIGT[\s\S]*?\n  }/,
  )?.[0] || '';
  assert.match(method, /STORES\.journalComment/);
  assert.match(method, /matchesIndex\(comment, 'journalUUID', journalUUID\)/);
  assert.doesNotMatch(method, /STORES\.comment/);
});
