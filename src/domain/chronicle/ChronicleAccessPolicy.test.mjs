import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accessPreset,
  canControlEntry,
  canEditEntry,
  canViewEntry,
} from './ChronicleAccessPolicy.js';
import { mergeChronicleText } from './ChronicleMerge.js';

test('Entry sharing presets keep visibility and edit policy independent but bounded', () => {
  assert.deepEqual(accessPreset('private'), { visibility: 'private', editPolicy: 'owner' });
  assert.deepEqual(accessPreset('fellows'), { visibility: 'fellows', editPolicy: 'owner' });
  assert.deepEqual(accessPreset('global'), { visibility: 'global', editPolicy: 'any_profile' });
  assert.throws(() => accessPreset('public'));
});

test('view, edit, and owner-control checks are centralized and fail closed', () => {
  const global = {
    ownerUUID: 'owner', visibility: 'global', editPolicy: 'any_profile', collaborationState: 'local',
  };
  assert.equal(canViewEntry(global, { viewerUUID: 'reader', lifecycleState: 'published' }), true);
  assert.equal(canEditEntry(global, { actorUUID: 'editor' }), true);
  assert.equal(canControlEntry(global, 'editor'), false);
  assert.equal(canControlEntry(global, 'owner'), true);
  assert.equal(canEditEntry({ ...global, collaborationState: 'locked' }, { actorUUID: 'editor' }), false);
  assert.equal(canViewEntry(global, { viewerUUID: null, lifecycleState: 'published' }), false);
  assert.equal(canViewEntry(global, { viewerUUID: 'reader', lifecycleState: 'archived' }), false);
});

test('legacy server-gated Global access is normalized into local cross-profile access', () => {
  const legacyGlobal = {
    ownerUUID: 'earlier-profile',
    visibility: 'global',
    editPolicy: 'any_authenticated',
    collaborationState: 'unavailable',
    authorityScope: 'shared',
  };
  assert.equal(canViewEntry(legacyGlobal, {
    viewerUUID: 'later-profile',
    lifecycleState: 'published',
  }), true);
  assert.equal(canEditEntry(legacyGlobal, { actorUUID: 'later-profile' }), true);
});

test('conservative merge accepts non-overlapping line edits and retains conflicts', () => {
  assert.deepEqual(mergeChronicleText({
    base: 'one\ntwo', current: 'ONE\ntwo', proposed: 'one\nTWO',
  }), { status: 'merged', value: 'ONE\nTWO' });
  assert.equal(mergeChronicleText({
    base: 'one', current: 'first', proposed: '1',
  }).status, 'conflict');
});
