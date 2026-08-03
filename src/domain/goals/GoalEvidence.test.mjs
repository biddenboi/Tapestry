import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [evidence, events, contribution] = await Promise.all([
  readFile(new URL('./GoalEvidence.js', import.meta.url), 'utf8'),
  readFile(new URL('../events/Events.js', import.meta.url), 'utf8'),
  readFile(new URL('../contribution/Contribution.js', import.meta.url), 'utf8'),
]);

test('linked habits resolve their Goal before using the idempotent action receipt', () => {
  assert.match(events, /recordLinkedActionContribution/);
  assert.match(events, /entityType: 'habit'/);
  assert.match(evidence, /resolvePrimaryLinkedGoalUUID/);
  assert.ok(contribution.includes('`action-contribution:${source}:${player.UUID}:${sourceUUID}`'));
});

test('journal evidence and milestone completion explicitly create no reward', () => {
  assert.match(evidence, /journalLinkCreatesReward\(\)[\s\S]*?return false/);
  assert.match(evidence, /milestoneCompletionCreatesReward\(\)[\s\S]*?return false/);
});
