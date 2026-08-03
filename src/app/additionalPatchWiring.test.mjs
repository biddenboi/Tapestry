import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');
const [session, sessionCss, arenaCss, markdownCss, nextMoveHost, previewLoader] = await Promise.all([
  read('../features/tasks/components/TaskSessionExpanded/TaskSessionExpanded.jsx'),
  read('../features/tasks/modals/TaskSessionMenu/TaskSessionMenu.css'),
  read('../features/matches/components/MatchArena/MatchArena.css'),
  read('../shared/markdown-editor/MarkdownEditor.css'),
  read('../features/navigation/components/EdgeNextMoveHost/EdgeNextMoveHost.jsx'),
  read('../features/tasks/modals/TaskPreviewMenu/loadTaskPreviewMenu.js'),
]);

test('active sessions use explicit outcomes and expose no reward-preview reel', () => {
  assert.match(session, /SessionOutcomeForm/);
  assert.match(session, /Optional focus boundary reached/);
  assert.doesNotMatch(session, /session-reward-anticipation|REWARD_PREVIEW_VALUES|Bonus Roll/);
  assert.doesNotMatch(sessionCss, /animation: session-reward-drift 7\.6s linear infinite/);
});

test('Match Arena pulse border is flush with the profile picture', () => {
  assert.match(arenaCss, /\.apn-pulse-ring \{[\s\S]*?inset: 0;[\s\S]*?border-radius: 4px;/);
});

test('blurred markdown preview stays inside the editor bounds', () => {
  assert.match(markdownCss, /\.md-editor-wrap \{[\s\S]*?overflow: hidden;/);
  assert.match(markdownCss, /\.md-preview \{[\s\S]*?overflow-y: auto;/);
  assert.match(markdownCss, /overflow-wrap: anywhere;/);
});

test('previewing an action does not masquerade as a started session', () => {
  assert.match(nextMoveHost, /todoCreatedAt: task\.todoCreatedAt \|\| task\.createdAt \|\| null,/);
  assert.match(nextMoveHost, /createdAt: null,/);
  assert.match(previewLoader, /void NiceModal\.show\(TaskPreviewMenu, props\)/);
  assert.doesNotMatch(previewLoader, /return NiceModal\.show/);
});
