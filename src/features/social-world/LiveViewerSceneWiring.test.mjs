import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('every current-scene consumer applies the synchronous live-viewer projection', () => {
  const consumers = [
    read('./components/SocialWorldShell/SocialWorldRuntime.jsx'),
    read('../lobby/components/Lobby/Lobby.jsx'),
    read('../matches/components/PracticeDojo/useDojoRoomController.js'),
  ];

  for (const source of consumers) {
    assert.match(source, /useLiveViewerScene/);
    assert.match(source, /preparedViewerScene/);
  }
});

test('the live-viewer hook derives location from current application state', () => {
  const hook = read('./hooks/useLiveViewerScene.js');

  assert.match(hook, /resolveSemanticLocation/);
  assert.match(hook, /gameState/);
  assert.match(hook, /activeTask/);
  assert.match(hook, /activePanel/);
  assert.match(hook, /withLiveViewerPresence/);
});
