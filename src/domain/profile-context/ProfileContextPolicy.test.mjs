import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateContextDisclosure } from './DisclosurePolicy.js';
import { validateProfileContextItem } from './Validation.js';

const future = '2099-01-01T00:00:00.000Z';
const base = {
  UUID: 'item',
  parent: 'owner',
  type: 'chapter',
  text: 'Shipping a first draft',
  source: 'manual',
  audience: 'private',
  sensitivity: 'low',
  status: 'active',
  expiresAt: future,
};

const decision = (patch, options) => evaluateContextDisclosure(
  { ...base, ...patch },
  {
    viewerId: 'viewer',
    subjectId: 'owner',
    relationshipTier: 'outside',
    preferences: { allowAvailability: false },
    asOf: new Date('2026-07-27T12:00:00.000Z'),
    ...options,
  },
);

test('strictest-wins disclosure matrix keeps private, selected, tier, source, and sensitivity boundaries', () => {
  assert.equal(decision({}, { viewerId: 'owner', relationshipTier: 'self' }).allowed, true);
  assert.equal(decision({ audience: 'private' }, { relationshipTier: 'friend' }).reason, 'audience');
  assert.equal(decision({ audience: 'selected' }, { relationshipTier: 'friend', recipientIds: ['viewer'] }).allowed, true);
  assert.equal(decision({ audience: 'selected' }, { relationshipTier: 'friend', recipientIds: ['someone-else'] }).allowed, false);
  assert.equal(decision({ audience: 'collaborators' }, { relationshipTier: 'friend' }).allowed, true);
  assert.equal(decision({ audience: 'collaborators' }, { relationshipTier: 'dynamic' }).allowed, false);
  assert.equal(decision({ audience: 'fellows' }, { relationshipTier: 'dynamic' }).allowed, true);
  assert.equal(decision({ audience: 'cast' }, { relationshipTier: 'outside' }).allowed, false);
  assert.equal(decision({
    audience: 'cast',
    sourceVisibility: 'private',
  }, { relationshipTier: 'friend' }).reason, 'source-visibility');
  assert.equal(decision({
    audience: 'cast',
    sensitivity: 'private',
  }, { relationshipTier: 'friend' }).reason, 'sensitivity');
});

test('status, expiry, availability opt-in, and automatic inference fail closed', () => {
  assert.equal(decision({ status: 'revoked', audience: 'cast' }, { relationshipTier: 'friend' }).allowed, false);
  assert.equal(decision({
    audience: 'cast',
    expiresAt: '2025-01-01T00:00:00.000Z',
  }, { relationshipTier: 'friend' }).reason, 'expired-time');
  assert.equal(decision({
    audience: 'cast',
    inGameTimestamp: 101,
  }, { relationshipTier: 'friend', asOfIGT: 100 }).reason, 'future-igt');
  assert.equal(decision({
    type: 'availability',
    audience: 'cast',
  }, { relationshipTier: 'friend' }).reason, 'availability-opt-out');

  const validation = validateProfileContextItem({
    ...base,
    source: 'derived',
    text: 'They appear stressed and burned out',
  });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(' '), /cannot infer mental health/i);
});
