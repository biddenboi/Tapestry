import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrajectory } from './ProfileTrajectory.js';

test('trajectory connects repeated factual work, explicit commitments, and receipt-backed rank movement', () => {
  const facts = [
    { id: 'a', kind: 'task', projectId: 'active', projectName: 'World pass', occurredIGT: 100, encounterId: 'e1' },
    { id: 'b', kind: 'task', projectId: 'active', projectName: 'World pass', occurredIGT: 200, encounterId: 'e2' },
    { id: 'c', kind: 'task', projectId: 'done', projectName: 'Old pass', occurredIGT: 50 },
  ];
  const result = buildTrajectory({
    facts,
    projectsById: new Map([
      ['active', { id: 'active', name: 'World pass', status: 'active' }],
      ['done', { id: 'done', name: 'Old pass', status: 'completed', completedAt: 'now' }],
    ]),
    openTodos: [
      { id: 'due', label: 'Review paths', dueAt: '2026-07-20', explicitCommitment: true },
      { id: 'guess', label: 'Maybe continue' },
    ],
    rankChanges: [{ id: 'rank', occurredIGT: 210, delta: 12 }],
    viewerIGT: 300,
  });
  assert.equal(result.strongestThread.projectId, 'active');
  assert.equal(result.strongestThread.state, 'continuing');
  assert.equal(result.strongestThread.encounterCount, 2);
  assert.equal(result.threads.find((thread) => thread.projectId === 'done').state, 'completed');
  assert.deepEqual(result.next.map((entry) => entry.id), ['due']);
  assert.deepEqual(result.rankChanges.map((entry) => entry.id), ['rank']);
});

test('trajectory never infers a next action or paused state from inactivity', () => {
  const result = buildTrajectory({
    facts: [{ id: 'a', kind: 'task', projectId: 'quiet', occurredIGT: 10 }],
    projectsById: new Map([['quiet', { id: 'quiet', name: 'Quiet project', status: 'active' }]]),
    openTodos: [{ id: 'undated', label: 'Undated' }],
    viewerIGT: 20 * 24 * 60 * 60 * 1000,
  });
  assert.equal(result.threads[0].state, 'inactive');
  assert.deepEqual(result.next, []);
});
