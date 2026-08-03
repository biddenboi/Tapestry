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
      '@app': alias('../../app'),
      '@data': alias('../../data'),
      '@domain': alias('../../domain'),
      '@features': alias('../../features'),
      '@shared': alias('../../shared'),
    },
  },
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});

test.after(async () => server.close());

const {
  processAchievementV2Event,
} = await server.ssrLoadModule('/domain/achievements-v2/AchievementV2Processor.js');
const {
  ACHIEVEMENT_DEFINITIONS_V2,
  RETIRED_ACHIEVEMENT_GROUPS,
} = await server.ssrLoadModule('/domain/achievements-v2/AchievementCatalogV2.js');

class MemoryAchievementRepository {
  constructor() {
    this.progress = new Map();
    this.awards = new Map();
    this.records = new Map();
  }

  progressKey(profileId, definitionId, version) {
    return `${profileId}:${definitionId}:${version}`;
  }

  async getProgress(profileId, definitionId, version) {
    return structuredClone(this.progress.get(this.progressKey(profileId, definitionId, version)) || {});
  }

  async saveProgress(profileId, definition, progress) {
    this.progress.set(
      this.progressKey(profileId, definition.id, definition.version),
      structuredClone(progress),
    );
  }

  async award({ profileId, definition, sourceEventIds, evidenceSnapshot }) {
    const key = `${profileId}:${definition.id}:${definition.version}`;
    if (this.awards.has(key)) return { id: key, awarded: false };
    this.awards.set(key, { definition, sourceEventIds, evidenceSnapshot });
    return { id: key, awarded: true };
  }

  async getRecord(profileId, recordId) {
    return structuredClone(this.records.get(`${profileId}:${recordId}`) || null);
  }

  async upsertRecord({ profileId, recordId, value, achievedAt, sourceEventId }) {
    const key = `${profileId}:${recordId}`;
    const prior = this.records.get(key);
    if (Number(prior?.value?.value) >= Number(value?.value)) return { updated: false, value: prior.value };
    this.records.set(key, { profileId, recordId, value, achievedAt, sourceEventId });
    return { updated: true, value };
  }

  async setRecord(record) {
    this.records.set(`${record.profileId}:${record.recordId}`, structuredClone(record));
    return { updated: true, value: record.value };
  }
}

function event(UUID, type, payload = {}) {
  return {
    UUID,
    parent: 'profile-1',
    type,
    sourceUUID: `${UUID}:source`,
    occurredAt: '2026-07-28T12:00:00.000Z',
    payload,
  };
}

test('v2 awards narrow evidence, records verified work, and replays idempotently', async () => {
  const achievementV2 = new MemoryAchievementRepository();
  const databaseConnection = { achievementV2 };
  const task = event('task-event-1', 'task-completed', {
    outcome: 'progressed',
    durationMs: 60 * 60 * 1000,
    durationVerified: true,
  });

  const first = await processAchievementV2Event(databaseConnection, task);
  const replay = await processAchievementV2Event(databaseConnection, task);

  assert.deepEqual(new Set(first.earned), new Set(['first_movement', 'focused_work']));
  assert.deepEqual(replay.earned, []);
  assert.equal(
    achievementV2.progress.get('profile-1:focused_work:2').bestMinutes,
    60,
  );
  assert.equal(
    achievementV2.records.get('profile-1:longest_focus_session').value.value,
    60,
  );
});

test('unverified elapsed time cannot become focused-work evidence or a personal record', async () => {
  const achievementV2 = new MemoryAchievementRepository();
  const result = await processAchievementV2Event(
    { achievementV2 },
    event('task-event-unverified', 'task-completed', {
      outcome: 'completed',
      durationMs: 24 * 60 * 60 * 1000,
      durationVerified: false,
    }),
  );

  assert.deepEqual(result.earned, ['first_movement']);
  assert.equal(achievementV2.records.has('profile-1:longest_focus_session'), false);
});

test('cross-domain evidence and Pair achievements explain their source events', async () => {
  const achievementV2 = new MemoryAchievementRepository();
  const databaseConnection = { achievementV2 };

  await processAchievementV2Event(databaseConnection, event('task-event-2', 'task-completed', {
    outcome: 'completed',
    durationMs: 5 * 60 * 1000,
    durationVerified: true,
  }));
  const journal = await processAchievementV2Event(databaseConnection, event('journal-event-1', 'journal-saved', {
    isNew: true,
    wordCount: 85,
    entryKind: 'entry',
  }));
  const match = await processAchievementV2Event(databaseConnection, event('match-event-1', 'match-completed', {
    won: true,
    fixedRuleset: true,
    settled: true,
    scoreMargin: 2,
    maxDeficitRecovered: 4,
    teammateUUID: 'profile-2',
    teamContributionRatio: 0.48,
    teamScore: 28,
  }));

  assert.ok(journal.earned.includes('evidence_trail'));
  assert.ok(journal.earned.includes('first_record'));
  assert.ok(match.earned.includes('balanced_pair'));
  assert.ok(match.earned.includes('rally'));
  assert.equal(
    achievementV2.awards.get('profile-1:balanced_pair:2').evidenceSnapshot.contributionRatio,
    0.48,
  );
});

test('the active catalog excludes the retired volume, endurance, and social-accumulation groups', () => {
  const activeIds = new Set(ACHIEVEMENT_DEFINITIONS_V2.map((definition) => definition.id));
  for (const retired of RETIRED_ACHIEVEMENT_GROUPS) {
    assert.equal(activeIds.has(retired), false, `${retired} must remain Legacy-only`);
  }
  assert.equal(ACHIEVEMENT_DEFINITIONS_V2.every((definition) => definition.evidenceRuleId), true);
});
