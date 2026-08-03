import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (await readFile(new URL('./ResidentAnalytics.js', import.meta.url), 'utf8'))
  .replace(/import \{[\s\S]*?\} from '\.\.\/analytics\/AnalyticsEvents\.js';/, `
    const normalizeAnalyticsEvent = (event, player) => ({ UUID: 'analytics-uuid', parent: event.parent || player?.UUID, ...event });
    const recordAnalyticsEvent = async (...args) => ({ path: 'generic', args });
  `)
  .replace(/import \{[\s\S]*?\} from '\.\/ResidentSubstitutionContracts\.js';/, `
    const RESIDENT_MODE={fullLive:'full-live',inGameTimeAligned:'in-game-time-aligned',off:'off'};
    const RESIDENT_TIME_BASIS={familiar:'familiar',liveWallClock:'live-wall-clock',viewerIGT:'viewer-igt'};
    const RESIDENT_ACTIVITY_CATEGORY={planning:'planning',taskSession:'task-session',dojo:'dojo',matchArena:'match-arena',marketplace:'marketplace',commons:'commons'};
    const RESIDENT_SUBSTITUTION_SNAPSHOT_VERSION=1;
  `);
const analytics = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('resident analytics exposes only the approved event vocabulary', () => {
  assert.deepEqual(Object.values(analytics.RESIDENT_ANALYTICS_EVENT), [
    'resident_mode_viewed',
    'resident_mode_changed',
    'resident_outbound_changed',
    'resident_slot_eligible',
    'resident_occupancy_started',
    'resident_occupancy_ended',
    'resident_card_rendered',
    'resident_public_profile_opened',
    'familiar_continuity_opened',
    'resident_education_shown',
    'resident_education_dismissed',
  ]);
});

test('metadata is strict, bounded, and rejects identity or activity text', () => {
  const prepared = analytics.sanitizeResidentAnalyticsMetadata({
    mode: 'full-live',
    timeBasis: 'live-wall-clock',
    activityCategory: 'dojo',
    slotRole: 'friend',
    candidateCountBucket: '2-5',
    featureCohort: 'beta_5',
  }, { surface: 'social-world' });
  assert.equal(Object.isFrozen(prepared), true);
  assert.deepEqual(prepared, {
    surface: 'social-world',
    mode: 'full-live',
    timeBasis: 'live-wall-clock',
    activityCategory: 'dojo',
    slotRole: 'friend',
    candidateCountBucket: '2-5',
    featureCohort: 'beta_5',
  });
  for (const metadata of [
    { taskText: 'secret' },
    { evidenceId: 'evidence' },
    { region: 'private' },
    { elo: 1500 },
    { blockReason: 'private' },
  ]) assert.throws(() => analytics.sanitizeResidentAnalyticsMetadata(metadata, { surface: 'provider' }));
});

test('unknown end reasons normalize and numeric buckets do not expose raw values', () => {
  assert.equal(analytics.normalizeResidentOccupancyEndReason('private-message'), 'other');
  assert.equal(analytics.residentOccupancyAgeBucket(14_999), 'under-15s');
  assert.equal(analytics.residentOccupancyAgeBucket(45_000), '45s-plus');
  assert.equal(analytics.residentCandidateCountBucket(17), '11-20');
});

test('recording prefers the typed resident persistence boundary', async () => {
  const calls = [];
  const db = { recordResidentAnalyticsEvent: async (...args) => { calls.push(args); return args[0]; } };
  const result = await analytics.recordResidentAnalyticsEvent(db, { UUID: 'viewer' }, {
    eventName: 'resident_card_rendered',
    surface: 'dojo',
    subjectId: 'resident',
    metadata: { timeBasis: 'viewer-igt', activityCategory: 'dojo' },
  });
  assert.equal(result.parent, 'viewer');
  assert.equal(result.targetUUID, 'resident');
  assert.equal(result.metadata.snapshotSchemaVersion, 1);
  assert.equal(calls.length, 1);
});
