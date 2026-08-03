import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseNextMove } from './NextMoveArbiter.js';
import { NEXT_MOVE_RESULT } from './NextMoveDecision.js';
import { NEXT_MOVE_REASON } from './NextMoveReasonCodes.js';

const base = Object.freeze({
  playerUUID: 'player-1',
  decisionPoint: 'test',
});

const candidate = (title, priorityClass = 3) => ({
  UUID: title.toLowerCase().replaceAll(' ', '-'),
  title,
  priorityClass,
});

const scenarios = [
  ['Pair Match outranks every other phase', {
    activePairMatch: candidate('Pair'),
    activeDojoSession: candidate('Dojo'),
    activeTaskSession: candidate('Task'),
    executableWork: candidate('Work'),
  }, NEXT_MOVE_RESULT.active, 'Pair'],
  ['Dojo outranks an active task', {
    activeDojoSession: candidate('Dojo'),
    activeTaskSession: candidate('Task'),
    executableWork: candidate('Work'),
  }, NEXT_MOVE_RESULT.active, 'Dojo'],
  ['active task outranks a commitment', {
    activeTaskSession: candidate('Task'),
    imminentCommitment: candidate('Meeting'),
  }, NEXT_MOVE_RESULT.active, 'Task'],
  ['fixed commitment outranks continuation', {
    imminentCommitment: candidate('Meeting'),
    continuation: candidate('Resume'),
  }, NEXT_MOVE_RESULT.commitment, 'Meeting'],
  ['continuation outranks clarification', {
    continuation: candidate('Resume'),
    clarification: { ...candidate('Clarify', 1), canImmediatelyUnlock: true },
  }, NEXT_MOVE_RESULT.continue, 'Resume'],
  ['higher-priority clarification preempts work', {
    clarification: { ...candidate('Clarify', 1), canImmediatelyUnlock: true },
    executableWork: candidate('Work', 2),
  }, NEXT_MOVE_RESULT.clarify, 'Clarify'],
  ['equal-priority execution beats planning', {
    clarification: { ...candidate('Clarify', 2), canImmediatelyUnlock: true },
    executableWork: candidate('Work', 2),
  }, NEXT_MOVE_RESULT.execute, 'Work'],
  ['lower-priority planning does not preempt work', {
    clarification: { ...candidate('Clarify', 3), canImmediatelyUnlock: true },
    executableWork: candidate('Work', 1),
  }, NEXT_MOVE_RESULT.execute, 'Work'],
  ['failed clarification does not repeat', {
    clarification: {
      ...candidate('Clarify', 1),
      canImmediatelyUnlock: true,
      failedSinceLastMaterialChange: true,
    },
    executableWork: candidate('Work', 2),
  }, NEXT_MOVE_RESULT.execute, 'Work'],
  ['non-unlocking clarification does not preempt', {
    clarification: { ...candidate('Clarify', 1), canImmediatelyUnlock: false },
    executableWork: candidate('Work', 2),
  }, NEXT_MOVE_RESULT.execute, 'Work'],
  ['clarification wins when no work exists', {
    clarification: { ...candidate('Clarify', 3), canImmediatelyUnlock: true },
  }, NEXT_MOVE_RESULT.clarify, 'Clarify'],
  ['executable work outranks day orientation', {
    executableWork: candidate('Work'),
    dayOrientation: candidate('Plan day'),
  }, NEXT_MOVE_RESULT.execute, 'Work'],
  ['day orientation outranks goal orientation', {
    dayOrientation: candidate('Plan day'),
    goalDirection: candidate('Choose milestone'),
  }, NEXT_MOVE_RESULT.reorientDay, 'Plan day'],
  ['goal orientation outranks reflection', {
    goalDirection: candidate('Choose milestone'),
    reflection: candidate('Reflect'),
  }, NEXT_MOVE_RESULT.reorientGoal, 'Choose milestone'],
  ['reflection outranks recovery', {
    reflection: candidate('Reflect'),
    recovery: candidate('Recover'),
  }, NEXT_MOVE_RESULT.reflect, 'Reflect'],
  ['recovery outranks a feasibility question', {
    recovery: candidate('Recover'),
    feasibilityQuestion: candidate('Ask'),
  }, NEXT_MOVE_RESULT.recover, 'Recover'],
  ['one feasibility question outranks low confidence', {
    feasibilityQuestion: candidate('Ask'),
    lowConfidence: candidate('Choose'),
  }, NEXT_MOVE_RESULT.ask, 'Ask'],
  ['low confidence produces an explicit choice state', {
    lowConfidence: candidate('Ambiguous'),
  }, NEXT_MOVE_RESULT.none, 'Ambiguous'],
  ['absence of evidence produces NO_MOVE', {}, NEXT_MOVE_RESULT.none, 'No move needed'],
  ['active recommendation has an exact destination', {
    activeTaskSession: {
      ...candidate('Current task'),
      entityType: 'task',
      entityUUID: 'task-1',
    },
  }, NEXT_MOVE_RESULT.active, 'Current task'],
  ['execution routes to task preview', {
    executableWork: {
      ...candidate('Write'),
      entityType: 'task',
      entityUUID: 'task-2',
    },
  }, NEXT_MOVE_RESULT.execute, 'Write'],
  ['clarification routes to its next-action field', {
    clarification: {
      ...candidate('Clarify', 1),
      entityType: 'task',
      entityUUID: 'task-3',
      canImmediatelyUnlock: true,
    },
  }, NEXT_MOVE_RESULT.clarify, 'Clarify'],
  ['goal reorientation preserves the goal identity', {
    goalDirection: {
      ...candidate('Set milestone'),
      entityUUID: 'goal-1',
    },
  }, NEXT_MOVE_RESULT.reorientGoal, 'Set milestone'],
  ['alternatives are bounded to two', {
    executableWork: candidate('Work'),
    alternatives: [candidate('A'), candidate('B'), candidate('C')],
  }, NEXT_MOVE_RESULT.execute, 'Work'],
];

for (const [name, state, expectedType, expectedTitle] of scenarios) {
  test(name, () => {
    const result = chooseNextMove({ ...base, ...state });
    assert.equal(result.rulesetVersion, 'next_move_v1');
    assert.equal(result.resultType, expectedType);
    assert.equal(result.title, expectedTitle);
    assert.ok(result.alternatives.length <= 2);
  });
}

test('active Pair Match decision exposes the governing reason code', () => {
  const result = chooseNextMove({ ...base, activePairMatch: candidate('Pair') });
  assert.ok(result.reasonCodes.includes(NEXT_MOVE_REASON.activePairMatch));
});

test('execution exposes V12 selection without a fabricated utility score', () => {
  const result = chooseNextMove({ ...base, executableWork: candidate('Work') });
  assert.ok(result.reasonCodes.includes(NEXT_MOVE_REASON.v12Selected));
  assert.equal('score' in result, false);
  assert.equal('utility' in result, false);
});

test('missing player identity is rejected', () => {
  assert.throws(() => chooseNextMove({}), /player UUID/);
});
