import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMobileChronicleDraftRecord,
  findRestorableMobileChronicleDraft,
  MOBILE_CHRONICLE_DRAFT_SURFACE,
} from './MobileChronicleDraft.js';

test('mobile Chronicle restores only its newest quick-capture draft', () => {
  const selected = findRestorableMobileChronicleDraft([
    { UUID: 'desktop', updatedAt: '2026-08-02T10:00:00.000Z', composerState: { surface: 'desktop' } },
    { UUID: 'older', updatedAt: '2026-08-02T11:00:00.000Z', composerState: { surface: MOBILE_CHRONICLE_DRAFT_SURFACE } },
    { UUID: 'newer', updatedAt: '2026-08-02T12:00:00.000Z', composerState: { surface: MOBILE_CHRONICLE_DRAFT_SURFACE } },
  ]);
  assert.equal(selected.UUID, 'newer');
});

test('mobile Chronicle draft records pin author, visibility, and composer identity', () => {
  assert.deepEqual(buildMobileChronicleDraftRecord({
    draftId: 'draft-1',
    playerUUID: 'player-1',
    title: 'Title',
    body: 'Body',
    visibility: 'global',
  }), {
    UUID: 'draft-1',
    parent: 'player-1',
    ownerUUID: 'player-1',
    title: 'Title',
    body: 'Body',
    visibility: 'global',
    composerState: { version: 1, surface: MOBILE_CHRONICLE_DRAFT_SURFACE },
  });
});

