import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('major user actions are wired into Contribution exactly at their durable action paths', async () => {
  const [
    contribution,
    taskProcessors,
    events,
    matchJobs,
    postComposer,
    journalDetail,
    goalRepository,
    actionSession,
  ] = await Promise.all([
    read('./Contribution.js'),
    read('../../features/tasks/domain/TaskCompletionProcessors.js'),
    read('../events/Events.js'),
    read('../matches/MatchPostMatchJobs.js'),
    read('../../features/feed/modals/PostComposerModal/PostComposerModal.jsx'),
    read('../../features/feed/modals/JournalDetailModal/JournalDetailModal.jsx'),
    read('../../data/persistence/repositories/GoalRepository.js'),
    read('../continuity/ActionSession.js'),
  ]);

  assert.match(taskProcessors, /recordTaskContribution/);
  assert.match(taskProcessors, /source:\s*'dojo'/);
  assert.match(events, /source:\s*'habit'/);
  assert.match(events, /source:\s*'quantity'/);
  assert.match(matchJobs, /source:\s*'match'/);
  assert.match(goalRepository, /source:\s*'goal-completed'/);
  assert.match(actionSession, /source:\s*'task-session'/);
  assert.doesNotMatch(events, /source:\s*'day-start'|source:\s*'day-end'/);
  assert.doesNotMatch(postComposer, /source:\s*'journal'/);
  assert.doesNotMatch(journalDetail, /source:\s*'journal-comment'/);
  assert.match(contribution, /export async function recordManualContribution/);
});

test('active Points path does not depend on retired task multipliers', async () => {
  const [tasks, completion, match] = await Promise.all([
    read('../tasks/Tasks.js'),
    read('../../features/tasks/domain/TaskCompletionService.js'),
    read('../matches/Match.js'),
  ]);

  assert.doesNotMatch(tasks, /export function getTaskMultiplier/);
  assert.doesNotMatch(completion, /getTaskMultiplier|eventBuff|multiplier/);
  assert.doesNotMatch(match, /1\.8\s*\*\s*7\.0\s*\*\s*2\.5/);
  assert.match(match, /const BASE_RATE = 1 \/ 10000/);
  assert.doesNotMatch(match, /MIN_RATE|MAX_RATE/);
});
