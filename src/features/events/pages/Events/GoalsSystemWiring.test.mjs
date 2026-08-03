import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [view, page, styles, repository, constants, documents] = await Promise.all([
  readFile(new URL('./EventsView.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./Events.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./styles/Goals.system.css', import.meta.url), 'utf8'),
  readFile(new URL('../../../../data/persistence/repositories/GoalRepository.js', import.meta.url), 'utf8'),
  readFile(new URL('../../../../domain/constants.js', import.meta.url), 'utf8'),
  readFile(new URL('../../../../data/persistence/sqlite/documentStores.js', import.meta.url), 'utf8'),
]);
const taskCreation = await readFile(
  new URL('../../../tasks/modals/TaskCreationMenu/TaskCreationMenu.jsx', import.meta.url),
  'utf8',
);
const taskDraftCommand = await readFile(
  new URL('../../../../domain/tasks/TaskDraftCommand.js', import.meta.url),
  'utf8',
);

test('Goals overview prioritizes focus, Areas, attention, and typed progress', () => {
  const overview = view.split('function GoalArenaBoard')[1].split('function Roadmap')[0];
  assert.match(overview, /FocusHero/);
  assert.match(overview, /Needs attention/);
  assert.match(overview, /Active Goals/);
  assert.match(overview, /Recent milestones/);
  assert.match(overview, /PurposeKey/);
  assert.match(view, /Stories.*do not measure progress/);
  assert.doesNotMatch(overview, /leaderboard|your rank|gap to next/i);
});

test('Goal detail keeps navigation above an independently scrollable section body', () => {
  const detail = view.split('function GoalDetail')[1].split('function GoalForm')[0];
  assert.ok(detail.indexOf('<LocalSectionNav') < detail.indexOf('goals-detail__hero'));
  assert.match(detail, /goals-detail__scroll/);
  assert.match(detail, /tab === 'overview'[\s\S]*goals-detail__hero/);
  assert.match(styles, /\.goals-detail\s*\{[^}]*grid-template-rows: auto auto minmax\(0, 1fr\);[^}]*overflow: hidden;/s);
  assert.match(styles, /\.goals-detail__scroll\s*\{[^}]*overflow-y: auto;/s);
});

test('manual reports are replaced by reward-free updates and competition is conditional', () => {
  assert.match(view, /Updates do not award Contribution or Coins/);
  assert.doesNotMatch(view, /REPORT CONTRIBUTION|ADD CONTRIBUTION/);
  assert.match(view, /participationMode === 'competitive'/);
  assert.match(view, /Contribution ranking/);
});

test('schema 42 stores are compact-backup compatible and Goals remain lazy', () => {
  assert.match(constants, /DATA_SCHEMA_VERSION = 42/);
  for (const store of ['goalAreas', 'goalMilestones', 'goalUpdates', 'goalLinks', 'goalParticipants']) {
    assert.match(constants, new RegExp(store));
    assert.match(documents, new RegExp(store));
  }
  for (const store of ['actionSessions', 'handoffs', 'rhythmOpportunities', 'rewardProvenance']) {
    assert.match(constants, new RegExp(store));
    assert.match(documents, new RegExp(store));
  }
  for (const store of ['profileContextItems', 'profileContextRecipients', 'profileContextSuggestions']) {
    assert.match(documents, new RegExp(store));
  }
  for (const store of ['taskPlanReceipts', 'nextMoveDecisions', 'nextMoveFeedback', 'nextMoveSurfacePreferences']) {
    assert.match(constants, new RegExp(store));
    assert.match(documents, new RegExp(store));
  }
  for (const store of ['contributionRoadStat', 'contributionRoadChoice', 'contributionRoadUnlock', 'contributionRoadMigration', 'interfaceRevealReceipt']) {
    assert.match(constants, new RegExp(store));
    assert.match(documents, new RegExp(store));
  }
  assert.match(page, /lazyGoalView\('GoalReview'\)/);
  assert.match(repository, /getOverview\(playerUUID, viewerIGT/);
  assert.match(repository, /getGoalDetail\(goalUUID, viewerIGT/);
});

test('all-theme Goals styling includes sharp-theme and responsive contracts', () => {
  assert.match(styles, /\[data-theme="old_windows"\]/);
  assert.match(styles, /\[data-theme="pixelated"\]/);
  assert.match(styles, /--theme-card-radius/);
  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('Todo Goal changes save the Todo and reciprocal association atomically', () => {
  const association = repository.split('async saveTodoGoalAssociation')[1].split('async removeLink')[0];
  assert.match(association, /requestedGoal/);
  assert.match(association, /projectId: goal\?\.UUID \|\| null/);
  assert.match(association, /label: 'todo-goal-association-save'/);
  assert.match(association, /STORES\.todo/);
  assert.match(association, /STORES\.goalLink/);
  assert.match(association, /commitAtomicMutation/);
  assert.match(taskCreation, /saveTaskDraftCommand/);
  assert.match(taskDraftCommand, /goalRepository\.saveTodoGoalAssociation\(task, player, \{ origin \}\)/);
  assert.match(taskCreation, /selectedProjectId/);
  assert.match(taskCreation, /DOMAIN_INVALIDATION\.goalLinkWrite/);
});
