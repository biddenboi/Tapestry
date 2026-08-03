import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activityKey,
  canonicalizeActivityFact,
  versionToken,
} from './SocialActivityFacts.js';

test('social facts keep stable identity while only visible meaning changes the version', () => {
  const source = {
    id: 'task-1', subjectId: 'subject', kind: 'task', label: 'Finish route',
    occurredIGT: 120, points: 40, durationMs: 3000, projectId: 'project-1',
  };
  assert.equal(activityKey('task', 'task-1'), 'task:task-1');
  assert.equal(
    versionToken('task', { ...source, updatedAt: 'later', cacheMetadata: { warm: true }, imageUrl: 'volatile' }),
    versionToken('task', { ...source, updatedAt: 'earlier', cacheMetadata: { warm: false }, imageUrl: 'other' }),
  );
  assert.notEqual(
    versionToken('task', source),
    versionToken('task', { ...source, label: 'Finish revised route' }),
  );
});

test('canonical facts expose bounded category and semantic version metadata', () => {
  const fact = canonicalizeActivityFact({
    UUID: 'visit-1', playerId: 'subject', kind: 'location', label: 'Left Dojo',
    occurredIGT: 500, location: 'dojo', startedIGT: 100, endedIGT: 500,
  });
  assert.equal(fact.key, 'location:visit-1');
  assert.equal(fact.category, 'Location');
  assert.match(fact.versionToken, /^v1:[a-f0-9]{16}$/);
  assert.equal(canonicalizeActivityFact({ id: 'bad', subjectId: 'subject', kind: 'narrative' }), null);
});
