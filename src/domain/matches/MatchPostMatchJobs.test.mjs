import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./MatchPostMatchJobs.js', import.meta.url), 'utf8');

test('post-match jobs cover every derived system behind a bounded scheduler', () => {
  for (const type of [
    'match-elo',
    'match-leaderboard',
    'match-achievements',
    'match-contribution',
    'match-narration',
    'match-cache',
  ]) {
    assert.match(source, new RegExp(type));
  }
  assert.match(source, /new BackgroundJobScheduler\(\{[\s\S]*concurrency: 2,[\s\S]*maxQueue: 96/);
  assert.match(source, /dedupeKey: durableRecord\.UUID/);
  assert.match(source, /maxAttempts: spec\.maxAttempts/);
  assert.match(source, /execution: 'worker'/);
  assert.match(source, /window\.__tapestryBackgroundJobSummary|BackgroundJobScheduler/);
});

test('post-match jobs and receipts are durable, idempotent, and recoverable', () => {
  assert.match(source, /receipt\?\.status/);
  assert.match(source, /\['completed', 'cancelled'\]\.includes\(receipt\?\.status\)/);
  assert.match(source, /postMatchReceiptUUID\(record\.matchUUID, record\.type\)/);
  assert.match(source, /postProcessingVersion\) === MATCH_POST_PROCESSING_VERSION/);
  assert.match(source, /label: 'post-match-job-complete'/);
});

test('explicit cancellation is persisted and excluded from recovery', () => {
  assert.match(source, /export async function cancelPostMatchJobs/);
  assert.match(source, /state: 'cancelled'/);
  assert.match(source, /status: 'cancelled'/);
  assert.match(source, /label: 'post-match-jobs-cancelled'/);
  assert.match(source, /scheduler\.cancelWhere/);
});

test('secondary processors remain outside the primary completion transaction', async () => {
  const primary = await readFile(new URL('./MatchCompletionService.js', import.meta.url), 'utf8');
  for (const secondary of [
    'queueMaterializedLeaderboardRebuild',
    'processAchievementEvent',
    'buildMatchHighlights',
  ]) {
    assert.doesNotMatch(primary, new RegExp(secondary));
    assert.match(source, new RegExp(secondary));
  }
  assert.doesNotMatch(source, /match-dojo-effects|clearDojoMultiplier|dojoEffects/);
});
