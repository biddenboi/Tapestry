import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [requirements, hydration, dojo, presentation, standings, hub, serving, policy, reporter] = await Promise.all([
  readFile(new URL('../../../../app/data-source/panelDomainRequirements.js', import.meta.url), 'utf8'),
  readFile(new URL('../../../../data/db/domainHydration.js', import.meta.url), 'utf8'),
  readFile(new URL('./usePracticeDojoController.js', import.meta.url), 'utf8'),
  readFile(new URL('./PracticeDojo.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./useDojoStandingsController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../../../app/shell/GameHub/GameHub.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../../../../domain/tasks/TaskRecommenderV12Serving.js', import.meta.url), 'utf8'),
  readFile(new URL('../../../../domain/tasks/TaskRecommenderV12Policy.js', import.meta.url), 'utf8'),
  readFile(new URL('../../../../domain/tasks/TaskRecommenderV12DevelopmentReporter.js', import.meta.url), 'utf8'),
]);

test('Dojo first paint adds only SQLite-backed social room domains to its narrow work source', () => {
  assert.match(requirements, /dojo: Object\.freeze\(\[D\.dojoSource, D\.recommender, D\.socialWorld, D\.social\]\)/);
  const requirement = requirements.match(/dojo: Object\.freeze\(\[([^\]]+)\]\)/)?.[1] || '';
  assert.doesNotMatch(requirement, /leaderboards|matches|D\.tasks/);
  assert.match(hydration, /dojoSource: 'dojoSource'/);
  assert.match(
    hydration,
    /\[HYDRATION_DOMAIN\.dojoSource\]: Object\.freeze\(\['tasks', 'todos'\]\)/,
  );
  assert.match(hub, /domainsForPanel\('dojo'\)/);
});

test('Dojo source uses workspace tasks, player-attributed history, and bounded typed standings', () => {
  assert.match(dojo, /getPlayerStore\(STORES\.task, ownerId\)/);
  assert.match(dojo, /getAll\(STORES\.todo\)/);
  assert.doesNotMatch(dojo, /getPlayerStore\(STORES\.todo, ownerId\)/);
  assert.doesNotMatch(dojo, /leaderboards|DojoLeaderboardSnapshots/);
  assert.match(presentation, /requestIdleCallback\(activate, \{ timeout: 5000 \}\)/);
  assert.match(standings, /ensureDomainLoaded\?\.\('leaderboards'\)/);
  assert.match(standings, /getDojoStandings\(\{/);
  assert.match(standings, /aroundRadius:\s*2/);
  assert.match(standings, /topLimit:\s*10/);
});

test('runtime optimization serves v12 scoring through the warm session without changing exploration contracts', () => {
  assert.match(dojo, /createTaskRecommenderWarmSession\(\{/);
  assert.match(dojo, /warmSession\?\.stage\(\{/);
  assert.match(serving, /buildTaskRecommenderV12PolicyDecision\(\{/);
  assert.match(policy, /TASK_RECOMMENDER_V12_DEFAULT_POSTERIOR_SAMPLES = 64/);
  assert.match(policy, /TASK_RECOMMENDER_V12_DEFAULT_SAFETY_FRACTION = 0\.1/);
  assert.match(reporter, /type: 'inference-performance'/);
  assert.match(reporter, /hydrationMs:/);
  assert.match(reporter, /scoringMs:/);
});
