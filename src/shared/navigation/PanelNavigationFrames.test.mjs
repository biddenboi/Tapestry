import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPanelNavigationFrame,
  popPanelNavigationFrame,
  pushPanelNavigationFrame,
} from './PanelNavigationFrames.js';

test('a contextual transition stores panel, subpage, entity, and profile identity', () => {
  const tasks = createPanelNavigationFrame({ panel: 'tasks', subview: 'planning' }, 'profile-a');
  const goal = createPanelNavigationFrame({
    panel: 'events',
    subview: 'goals',
    entityType: 'goal',
    entityUUID: 'goal-1',
  }, 'profile-a');
  const history = pushPanelNavigationFrame([], tasks, goal);
  assert.deepEqual(history, [{
    panel: 'tasks',
    subview: 'planning',
    entityType: null,
    entityUUID: null,
    profileUUID: 'profile-a',
  }]);
  assert.deepEqual(popPanelNavigationFrame(history), { history: [], frame: tasks });
});

test('same-frame transitions do not create duplicate history', () => {
  const frame = createPanelNavigationFrame({ panel: 'feed', subview: 'yours' }, 'profile-a');
  assert.deepEqual(pushPanelNavigationFrame([], frame, { ...frame }), []);
});

