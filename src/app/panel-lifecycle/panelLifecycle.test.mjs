import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./panelLifecycle.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {
  PANEL_LIFECYCLE_EVENT,
  PANEL_LIFECYCLE_STATE,
  canPanelLoad,
  effectivePanelLifecycle,
  isPanelActive,
  isPanelMounted,
  transitionPanelLifecycle,
} = await import(moduleUrl);

test('panel lifecycle follows unloaded to loading to active to suspended to disposed', () => {
  let state = PANEL_LIFECYCLE_STATE.unloaded;
  state = transitionPanelLifecycle(state, PANEL_LIFECYCLE_EVENT.request);
  assert.equal(state, PANEL_LIFECYCLE_STATE.loading);
  state = transitionPanelLifecycle(state, PANEL_LIFECYCLE_EVENT.ready);
  assert.equal(state, PANEL_LIFECYCLE_STATE.active);
  state = transitionPanelLifecycle(state, PANEL_LIFECYCLE_EVENT.suspend);
  assert.equal(state, PANEL_LIFECYCLE_STATE.suspended);
  state = transitionPanelLifecycle(state, PANEL_LIFECYCLE_EVENT.dispose);
  assert.equal(state, PANEL_LIFECYCLE_STATE.disposed);
});

test('suspended panels can resume without reloading while disposed panels reload', () => {
  assert.equal(
    transitionPanelLifecycle(PANEL_LIFECYCLE_STATE.suspended, PANEL_LIFECYCLE_EVENT.resume),
    PANEL_LIFECYCLE_STATE.active,
  );
  assert.equal(
    transitionPanelLifecycle(PANEL_LIFECYCLE_STATE.disposed, PANEL_LIFECYCLE_EVENT.request),
    PANEL_LIFECYCLE_STATE.loading,
  );
});

test('only loading and active panels may hydrate, and only active panels may run recurring work', () => {
  assert.equal(canPanelLoad(PANEL_LIFECYCLE_STATE.loading), true);
  assert.equal(canPanelLoad(PANEL_LIFECYCLE_STATE.active), true);
  assert.equal(canPanelLoad(PANEL_LIFECYCLE_STATE.suspended), false);
  assert.equal(isPanelActive(PANEL_LIFECYCLE_STATE.loading), false);
  assert.equal(isPanelActive(PANEL_LIFECYCLE_STATE.active), true);
  assert.equal(isPanelMounted(PANEL_LIFECYCLE_STATE.suspended), true);
  assert.equal(isPanelMounted(PANEL_LIFECYCLE_STATE.disposed), false);
});

test('effective lifecycle suspends a hidden active panel immediately', () => {
  assert.equal(
    effectivePanelLifecycle(PANEL_LIFECYCLE_STATE.active, false),
    PANEL_LIFECYCLE_STATE.suspended,
  );
  assert.equal(
    effectivePanelLifecycle(PANEL_LIFECYCLE_STATE.disposed, true),
    PANEL_LIFECYCLE_STATE.loading,
  );
});
