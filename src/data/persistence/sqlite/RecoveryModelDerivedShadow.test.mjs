import assert from 'node:assert/strict';
import test from 'node:test';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const fixed = new Date('2026-07-13T01:00:00.000Z');

async function setup() {
  const context = await createShadowTestContext({ now: () => fixed });
  await context.shadow.importers.coreProfiles.import({
    players: [
      { UUID: 'p1', username: 'Alpha', elo: 1100, achievements: {}, createdAt: fixed.toISOString() },
      { UUID: 'p2', username: 'Beta', elo: 1000, achievements: {}, createdAt: fixed.toISOString() },
    ], appState: { activePlayerUUID: 'p1' },
  });
  await context.shadow.importers.planning.import({
    projects: [{ UUID: 'goal-1', parent: 'p1', name: 'Goal' }],
    tasks: [{
      UUID: 'task-1', parent: 'p1', projectId: 'goal-1', name: 'Task',
      completedAt: fixed.toISOString(), points: 50, pointsBase: 50,
    }],
  });
  return context;
}

function achievementEvent(id = 'achievement-event-1') {
  return {
    UUID: id, parent: 'p1', type: 'task-completed', sourceUUID: 'task-1',
    eventSchemaVersion: 1, occurredAt: fixed.toISOString(), createdAt: fixed.toISOString(),
    payload: { points: 50, completedAt: fixed.toISOString() },
  };
}

function completedState(eventId = 'achievement-event-1') {
  return {
    counterVersion: 1,
    counters: { completedTasks: 1, lifetimeTaskPoints: 50 },
    appliedEvents: { [eventId]: fixed.toISOString() },
    eventAwards: { [eventId]: ['grinder_1'] },
  };
}

test('Batch 22 achievement events, state, receipts, and reward confirmation are replay-safe', async (t) => {
  const context = await setup();
  t.after(context.close);
  const recorded = await context.shadow.recoveryModel.recordAchievementEvent(achievementEvent(), { operationId: 'record-1' });
  assert.equal(recorded.duplicate, false);
  assert.equal((await context.shadow.recoveryModel.listPendingAchievementEvents()).length, 1);

  const first = await context.shadow.recoveryModel.completeAchievementEvent({
    eventId: 'achievement-event-1', playerId: 'p1', operationId: 'process-1',
    processorVersion: 1, state: completedState(), earnedKeys: ['grinder_1'], completedAt: fixed,
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.state.counters.completedTasks, 1);
  assert.deepEqual(first.receipt.earnedKeys, ['grinder_1']);
  assert.equal((await context.shadow.recoveryModel.listPendingAchievementEvents()).length, 0);

  const replay = await context.shadow.recoveryModel.completeAchievementEvent({
    eventId: 'achievement-event-1', playerId: 'p1', operationId: 'process-other',
    processorVersion: 1, state: { ...completedState(), counters: { completedTasks: 99 } },
    earnedKeys: ['wrong'], completedAt: fixed,
  });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.state.counters.completedTasks, 1);
  assert.deepEqual(replay.receipt.earnedKeys, ['grinder_1']);

  const reward = await context.shadow.recoveryModel.markAchievementRewardsIssued('achievement-event-1', {
    operationId: 'reward-1', issuedKeys: ['grinder_1'], issuedAt: fixed,
  });
  assert.deepEqual(reward.receipt.issuedKeys, ['grinder_1']);
  assert.ok(reward.receipt.rewardIssuedAt);
  const rewardReplay = await context.shadow.recoveryModel.markAchievementRewardsIssued('achievement-event-1', {
    operationId: 'reward-1', issuedKeys: ['wrong'], issuedAt: fixed,
  });
  assert.equal(rewardReplay.duplicate, true);
  assert.deepEqual(rewardReplay.receipt.issuedKeys, ['grinder_1']);
});

test('Batch 22 achievement command side effects roll back together on interruption', async (t) => {
  const context = await setup();
  t.after(context.close);
  await context.shadow.recoveryModel.recordAchievementEvent(achievementEvent('rollback-event'));
  await assert.rejects(context.client.executeAtomic({
    commandId: 'achievement-forced-rollback', label: 'achievement-forced-rollback', statements: [
      {
        sql: `INSERT INTO achievement_process_commands(
                operation_id,event_id,player_id,processor_version,counter_version,counters_json,
                applied_events_json,event_awards_json,earned_keys_json,removed_keys_json,completed_at
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        bind: ['rollback-op','rollback-event','p1',1,1,'{"completedTasks":1}','{"rollback-event":"done"}','{}','[]','[]',fixed.toISOString()],
        result: 'changes',
      },
      { sql: 'INSERT INTO missing_achievement_table(id) VALUES(1)' },
    ],
  }));
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM achievement_receipts WHERE event_id='rollback-event'", result: 'value' }), 0);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM achievement_states WHERE player_id='p1'", result: 'value' }), 0);
  assert.equal((await context.shadow.recoveryModel.listPendingAchievementEvents()).length, 1);
});

test('Batch 22 analytics are typed, deduplicated, and replayable', async (t) => {
  const context = await setup();
  t.after(context.close);
  const analytics = { UUID: 'analytics-1', parent: 'p1', eventName: 'feed_post_opened', surface: 'feed', targetType: 'journal', targetUUID: 'journal-1', metadata: { source: 'feed' }, createdAt: fixed.toISOString() };
  assert.equal((await context.shadow.recoveryModel.recordAnalyticsEvent(analytics, { dedupeWindowMs: 1000 })).duplicate, false);
  assert.equal((await context.shadow.recoveryModel.recordAnalyticsEvent({ ...analytics, UUID: 'analytics-2', createdAt: new Date(fixed.getTime()+500).toISOString() }, { dedupeWindowMs: 1000 })).duplicate, true);
  assert.deepEqual((await context.shadow.recoveryModel.listAnalyticsEvents('p1')).map((row) => row.UUID), ['analytics-1']);
});

test('Batch 22 SQL views remain current after all disposable caches are deleted', async (t) => {
  const context = await setup();
  t.after(context.close);
  await context.shadow.importers.social.import({
    friendships: [{ UUID: 'accepted-friend', players: ['p1','p2'], requestedBy: 'p1', status: 'accepted', createdAt: fixed.toISOString(), acceptedAt: fixed.toISOString() }],
  });
  await context.shadow.importers.events.import({
    contributions: [{ UUID: 'contrib-1', parent: 'p1', projectId: 'goal-1', source: 'manual', value: 7, createdAt: fixed.toISOString() }],
  });
  const summary = await context.shadow.recoveryModel.getProfileSummary('p1');
  assert.equal(summary.completedTasks, 1);
  assert.equal(summary.taskPoints, 50);
  assert.equal(summary.acceptedFriends, 1);
  assert.equal(summary.contributionTotal, 7);

  await context.shadow.recoveryModel.putDerivedCache({
    cacheKey: 'profile:p1', cacheKind: 'profile-summary', requiredSources: ['social','tasks'],
    payload: { copied: 'disposable' }, operationId: 'cache-put-1', createdAt: fixed,
  });
  assert.equal((await context.shadow.recoveryModel.getDerivedCache('profile:p1')).stale, false);
  await context.shadow.recoveryModel.invalidateSources(['social'], { operationId: 'invalidate-social-1', invalidatedAt: fixed });
  assert.equal(await context.shadow.recoveryModel.getDerivedCache('profile:p1'), null);
  assert.equal((await context.shadow.recoveryModel.getDerivedCache('profile:p1', { includeStale: true })).stale, true);

  const deleted = await context.shadow.recoveryModel.deleteAllDerivedCaches({ operationId: 'delete-all-caches' });
  assert.equal(deleted.deleted, 1);
  assert.equal(await context.client.query({ sql: 'SELECT COUNT(*) FROM derived_cache_entries', result: 'value' }), 0);
  const rebuilt = await context.shadow.recoveryModel.getProfileSummary('p1');
  assert.deepEqual(rebuilt, summary);
  assert.equal((await context.shadow.recoveryModel.getContributionLeaderboard())[0].playerId, 'p1');
  assert.equal(await context.client.query({ sql: 'SELECT COUNT(*) FROM tasks', result: 'value' }), 1);
  assert.equal(await context.client.query({ sql: 'SELECT COUNT(*) FROM friendships', result: 'value' }), 1);
});

test('Batch 22 importer is deterministic, quarantines malformed records, and never promotes copied profile summaries', async (t) => {
  const context = await setup();
  t.after(context.close);
  const fixture = {
    achievementEvents: [achievementEvent('import-event')],
    achievementStates: [{ UUID: 'achievement-state:p1', parent: 'p1', counterVersion: 1, counters: { completedTasks: 1 }, appliedEvents: { 'import-event': fixed.toISOString() }, eventAwards: {}, needsReconciliation: false, createdAt: fixed.toISOString(), updatedAt: fixed.toISOString() }],
    achievementReceipts: [{ UUID: 'achievement-receipt:import-event', parent: 'p1', eventUUID: 'import-event', processorVersion: 1, status: 'completed', earnedKeys: [], removedKeys: [], issuedKeys: [], createdAt: fixed.toISOString(), completedAt: fixed.toISOString(), updatedAt: fixed.toISOString() }],
    analyticsEvents: [{ UUID: 'import-analytics', parent: 'p1', eventName: 'opened', surface: 'app', createdAt: fixed.toISOString() }],
    derivedCaches: [{ UUID: 'legacy-cache', kind: 'profile-summary', payload: { copied: true } }],
    profileSummaries: [{ UUID: 'p1', player: { UUID: 'p1', username: 'stale copy' } }],
  };
  const imported = await context.shadow.importers.recoveryModel.import(fixture);
  assert.deepEqual(imported.counts, {
    achievementEvents: 1, achievementStates: 1, achievementReceipts: 1,
    analyticsEvents: 1,
    derivedCaches: 1, profileSummariesReplacedByView: 1, diagnostics: 2,
  });
  assert.ok(imported.diagnostics.some((row) => row.reason === 'replaced-by-sql-view'));
  assert.equal((await context.shadow.recoveryModel.getDerivedCache('legacy-cache', { includeStale: true })).stale, true);
  assert.equal((await context.shadow.recoveryModel.getProfileSummary('p1')).username, 'Alpha');
  assert.equal((await context.shadow.importers.recoveryModel.import(fixture)).duplicate, true);
  assert.deepEqual(await context.client.query({ sql: 'PRAGMA foreign_key_check', result: 'all' }), []);
});

test('Batch 22 profile wipe deletes personal analytics while retaining anonymized recovery facts', async (t) => {
  const context = await setup();
  t.after(context.close);
  await context.shadow.recoveryModel.recordAchievementEvent(achievementEvent('wipe-event'));
  await context.shadow.recoveryModel.completeAchievementEvent({
    eventId: 'wipe-event', playerId: 'p1', operationId: 'wipe-process', state: completedState('wipe-event'), completedAt: fixed,
  });
  await context.shadow.recoveryModel.recordAnalyticsEvent({ UUID: 'wipe-analytics', parent: 'p1', eventName: 'opened', surface: 'app', createdAt: fixed.toISOString() });

  const wiped = await context.shadow.coreProfiles.wipeProfile('p1', { operationId: 'wipe-recovery-model-p1', now: fixed });
  assert.equal(wiped.counts.achievementEventsAnonymized, 1);
  assert.equal(wiped.counts.achievementReceiptsAnonymized, 1);
  assert.equal(await context.client.query({ sql: "SELECT player_id FROM achievement_events WHERE id='wipe-event'", result: 'value' }), null);
  assert.equal(await context.client.query({ sql: "SELECT player_id FROM achievement_receipts WHERE event_id='wipe-event'", result: 'value' }), null);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM achievement_states WHERE player_id='p1'", result: 'value' }), 0);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM analytics_events WHERE player_id='p1'", result: 'value' }), 0);
  assert.deepEqual(await context.client.query({ sql: 'PRAGMA foreign_key_check', result: 'all' }), []);
});
