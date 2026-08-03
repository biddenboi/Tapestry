import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conservativeChronicleMetadata,
  validateChronicleEntryContent,
} from './ChronicleEntryKind.js';
import {
  canViewChronicleEntry,
  publicChronicleMetadata,
} from './ChronicleVisibility.js';
import {
  compareChronicleFeedItems,
  decodeChronicleFeedCursor,
  encodeChronicleFeedCursor,
  isAfterChronicleCursor,
} from './ChronicleFeedCursor.js';
import { bundleChronicleMoments } from './MomentBundling.js';
import { moveStoryEntry, visibleStorySequence } from './StoryOrdering.js';
import { isChronicleResurfaceEligible, onThisDayCandidates } from './ChronicleResurfacePolicy.js';

const base = {
  lifecycleState: 'published',
  visibility: 'fellows',
  playerUUID: 'p1',
  occurrenceAt: '2025-07-28T12:00:00.000Z',
  occurrenceIGT: 10,
  publishedAt: '2026-07-28T12:00:00.000Z',
};

test('entry kinds validate intentionally and legacy journals backfill conservatively', () => {
  assert.equal(validateChronicleEntryContent({ kind: 'moment', body: 'Trace' }).valid, true);
  assert.equal(validateChronicleEntryContent({ kind: 'essay', body: 'Untitled' }).valid, false);
  assert.equal(validateChronicleEntryContent({ kind: 'essay', title: 'Named' }).valid, true);
  const visible = conservativeChronicleMetadata({ UUID: 'j1', parent: 'p1', createdAt: base.publishedAt });
  assert.equal(visible.entryKind, 'entry');
  assert.equal(visible.visibility, 'fellows');
  assert.equal(visible.publishedAt, base.publishedAt);
  const draft = conservativeChronicleMetadata({
    UUID: 'j2', parent: 'p1', createdAt: base.publishedAt, visibility: 'draft',
  });
  assert.equal(draft.lifecycleState, 'draft');
  assert.equal(draft.visibility, 'private');
});

test('visibility enforces lifecycle, viewer IGT, owner access, and private context projection', () => {
  assert.equal(canViewChronicleEntry(base, { viewerUUID: 'p2', viewerIGT: 10 }), true);
  assert.equal(canViewChronicleEntry(base, { viewerUUID: 'p2', viewerIGT: 9 }), false);
  assert.equal(canViewChronicleEntry({ ...base, visibility: 'private' }, { viewerUUID: 'p2' }), false);
  assert.equal(canViewChronicleEntry({ ...base, visibility: 'private' }, { viewerUUID: 'p1' }), true);
  const projected = publicChronicleMetadata({
    ...base,
    contextSnapshot: { version: 1, private: { goal: 'secret' }, shared: { season: 'summer' } },
  }, 'p2');
  assert.equal('private' in projected.contextSnapshot, false);
  assert.deepEqual(projected.contextSnapshot.shared, { season: 'summer' });
});

test('Feed cursor ordering is deterministic at timestamp ties', () => {
  const rows = [
    { ...base, UUID: 'a', journalUUID: 'a' },
    { ...base, UUID: 'c', journalUUID: 'c' },
    { ...base, UUID: 'b', journalUUID: 'b' },
  ].sort(compareChronicleFeedItems);
  assert.deepEqual(rows.map((row) => row.UUID), ['c', 'b', 'a']);
  const encoded = encodeChronicleFeedCursor(rows[1]);
  assert.deepEqual(decodeChronicleFeedCursor(encoded), {
    version: 1,
    publishedAt: base.publishedAt,
    journalUUID: 'b',
  });
  assert.equal(isAfterChronicleCursor(rows[2], encoded), true);
  assert.equal(isAfterChronicleCursor(rows[0], encoded), false);
});

test('Moments bundle only within author/day/context/time and cap at four', () => {
  const moments = Array.from({ length: 5 }, (_, index) => ({
    ...base,
    UUID: `m${index}`,
    parent: 'p1',
    entryKind: 'moment',
    publishedAt: new Date(new Date(base.publishedAt).getTime() - index * 60000).toISOString(),
  }));
  const result = bundleChronicleMoments(moments);
  assert.equal(result.length, 2);
  assert.equal(result[0].type, 'moment-bundle');
  assert.equal(result[0].itemCount, 4);
  assert.equal(result[1].UUID, 'm4');
  assert.equal(bundleChronicleMoments([{ ...moments[0], standaloneInFeed: true }])[0].type, undefined);
});

test('Story movement preserves explicit order and visible ordinals hide gaps', () => {
  const memberships = ['a', 'b', 'c'].map((journalUUID, index) => ({ journalUUID, ordinal: index + 1 }));
  assert.deepEqual(moveStoryEntry(memberships, 'c', 'up').map((row) => row.journalUUID), ['a', 'c', 'b']);
  const entries = new Map([['a', { UUID: 'a' }], ['b', { UUID: 'b', private: true }], ['c', { UUID: 'c' }]]);
  const visible = visibleStorySequence(memberships, entries, (entry) => !entry.private);
  assert.deepEqual(visible.map(({ journalUUID, visibleOrdinal, visibleCount }) => ({
    journalUUID, visibleOrdinal, visibleCount,
  })), [
    { journalUUID: 'a', visibleOrdinal: 1, visibleCount: 2 },
    { journalUUID: 'c', visibleOrdinal: 2, visibleCount: 2 },
  ]);
});

test('resurfacing honors suppression, cooldown, and On This Day', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');
  assert.equal(isChronicleResurfaceEligible({ ...base, resurfacePolicy: 'never' }, { now }), false);
  assert.equal(isChronicleResurfaceEligible({
    ...base,
    lastShownAt: '2026-07-20T00:00:00.000Z',
  }, { now }), false);
  assert.deepEqual(onThisDayCandidates([
    { ...base, UUID: 'anniversary' },
    { ...base, UUID: 'other', occurrenceAt: '2025-07-27T12:00:00.000Z' },
  ], now).map((entry) => entry.UUID), ['anniversary']);
});
