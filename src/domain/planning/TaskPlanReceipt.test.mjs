import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consumeTaskPlanReceipt,
  createTaskPlanReceipt,
  failTaskPlanReceipt,
  hashTaskRevision,
  invalidateTaskPlanReceipt,
  isTaskPlanReceiptValid,
} from './TaskPlanReceipt.js';
import {
  descriptionHasPlanTag,
  normalizeTaskPlanningMetadata,
  taskIsAmbiguityBlocked,
  taskIsExecutableNow,
} from './TaskPlanningEligibility.js';

const task = Object.freeze({
  UUID: 'task-1',
  name: 'Draft launch note',
  description: 'Write the launch note #plan',
  estimatedDuration: 30,
  planEligible: true,
  needsPlanning: true,
});

test('meaningful task revisions are stable and ignore presentation-only updates', () => {
  assert.equal(hashTaskRevision(task), hashTaskRevision({ ...task, updatedAt: 'later', color: 'pink' }));
  assert.notEqual(hashTaskRevision(task), hashTaskRevision({ ...task, description: 'Changed scope #plan' }));
});

test('canonical description metadata recognizes an explicit plan tag', () => {
  assert.equal(descriptionHasPlanTag('A task #plan'), true);
  assert.equal(descriptionHasPlanTag('A task #planning'), false);
  assert.equal(normalizeTaskPlanningMetadata({
    UUID: 'legacy',
    efficiency: 'Legacy description #plan',
  }).planEligible, true);
});

test('a receipt requires one next visible action and captures bounded metadata', () => {
  assert.throws(() => createTaskPlanReceipt({ playerUUID: 'p', task }), /next visible action/);
  const receipt = createTaskPlanReceipt({
    id: 'receipt-1',
    playerUUID: 'p',
    task,
    nextAction: 'Open the draft and write the headline.',
    intendedOpportunity: { triggerType: 'time', triggerValue: '09:00' },
    optionalSteps: ['Add context', '', 'Proofread'],
    estimatedRemainingMinutes: 31.6,
  });
  assert.equal(receipt.nextAction, 'Open the draft and write the headline.');
  assert.deepEqual(receipt.optionalSteps, ['Add context', 'Proofread']);
  assert.equal(receipt.estimatedRemainingMinutes, 32);
  assert.equal(isTaskPlanReceiptValid(receipt, task), true);
});

test('material task edits invalidate a prior receipt', () => {
  const receipt = createTaskPlanReceipt({
    id: 'receipt-2',
    playerUUID: 'p',
    task,
    nextAction: 'Open the draft.',
  });
  assert.equal(isTaskPlanReceiptValid(receipt, { ...task, name: 'Different outcome' }), false);
  assert.equal(invalidateTaskPlanReceipt(receipt).status, 'invalidated');
  assert.equal(consumeTaskPlanReceipt(receipt).status, 'consumed');
});

test('valid receipts make plan-eligible work executable', () => {
  const receipt = createTaskPlanReceipt({
    id: 'receipt-3',
    playerUUID: 'p',
    task,
    nextAction: 'Open the draft.',
  });
  assert.equal(taskIsAmbiguityBlocked(task, null), true);
  assert.equal(taskIsExecutableNow(task, { receipt }), true);
});

test('one failed clarified action blocks the task and prevents a planning loop', () => {
  const receipt = createTaskPlanReceipt({
    id: 'receipt-4',
    playerUUID: 'p',
    task,
    nextAction: 'Open the draft.',
  });
  const failed = failTaskPlanReceipt(receipt, task, '2026-07-28T00:00:00.000Z');
  assert.equal(failed.receipt.status, 'invalidated');
  assert.equal(failed.receipt.failureCount, 1);
  assert.equal(failed.task.status, 'blocked');
  assert.equal(failed.task.clarificationFailures, 1);
  assert.equal(taskIsAmbiguityBlocked(failed.task, failed.receipt), false);
});
