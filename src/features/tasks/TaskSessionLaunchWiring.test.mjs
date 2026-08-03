import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [provider, preview, matchArena, dojo] = await Promise.all([
  read('./context/TaskSessionProvider.jsx'),
  read('./modals/TaskPreviewMenu/TaskPreviewMenu.jsx'),
  read('../matches/components/MatchArena/MatchArena.jsx'),
  read('../matches/components/PracticeDojo/usePracticeDojoController.js'),
]);

test('task sessions require an explicit start request instead of a task creation timestamp', () => {
  assert.match(provider, /taskSessionRequestKey\(activeTask\)/);
  assert.match(provider, /startedAt: taskSessionRequestedAt\(activeTask\)/);
  assert.doesNotMatch(provider, /startedAt: activeTask\.createdAt/);
  assert.match(preview, /sessionRequestedAt: sessionStartedAt/);
  assert.match(dojo, /sessionRequestedAt: null/);
  assert.match(dojo, /loadTaskPreviewMenu\(\)/);
  assert.match(dojo, /NiceModal\.show\(TaskPreviewMenu\)/);
});

test('Match recommendations remain previews until Start is pressed', () => {
  const launch = matchArena.slice(
    matchArena.indexOf('const handleStartNext'),
    matchArena.indexOf('const handleReturn'),
  );
  assert.match(launch, /todoCreatedAt: launched\.task\.todoCreatedAt \|\| launched\.task\.createdAt \|\| null/);
  assert.match(launch, /createdAt: null/);
  assert.match(launch, /sessionRequestedAt: null/);
  assert.match(launch, /showTaskPreviewMenu/);
});
