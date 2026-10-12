import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY } from '@domain/constants.js';
import { createGateState, normalizeGateState, gateItemPrice, gateItemMissing, captureGateItem, editGateItem, deleteGateItem, trackedHoursSince, gateConditions, todayLock, openGateWindow, lockGateItem, advanceGateItem, addGateCheck, toggleGateCheck, returnGateItem, releaseGateWindow } from './Gate.js';
import { slug, buildDesignPrompt, buildBuildPrompt } from './GatePrompts.js';
const now = new Date('2026-10-12T12:00:00Z');
const later = new Date(+now + 21 * DAY);
const capture = (state, id = 'a', kind = 'bug') => captureGateItem(state, { kind, text: `Fix ${id}`, why: 'It is broken', replaces: 'Old flow' }, { now, id });
const opened = () => openGateWindow(capture(createGateState(now)), { conditions: { allMet: true }, now: later });
const locked = () => lockGateItem(opened(), 'a', { ledgerUUID: 'charge' }).state;
const verify = () => advanceGateItem(advanceGateItem(locked(), 'a'), 'a');
const done = () => advanceGateItem(toggleGateCheck(addGateCheck(verify(), 'a', 'Works', { checkId: 'c' }), 'a', 'c'), 'a');
const code = (expected) => (error) => error.code === expected;
test('prices follow the reward schedule and reject unknown kinds', () => {
  assert.deepEqual(['add','change','remove','bug'].map(gateItemPrice), [60,30,15,0]);
  assert.throws(() => gateItemPrice('other'), code('unknown-kind'));
});
test('creation earns the first release too and normalization clones', () => {
  const state = createGateState(now);
  assert.equal(state.lastReleaseAt, now.toISOString());
  assert.deepEqual(normalizeGateState(null, now), state);
  assert.deepEqual(normalizeGateState({ schemaVersion: 9 }, now), state);
  assert.notEqual(normalizeGateState(state, now), state);
});
test('capture, readiness, edits and deletion preserve prior states', () => {
  const state = createGateState(now);
  const next = captureGateItem(state, { kind: 'add', text: ' New ', why: '', replaces: '' }, { now, id: 'a' });
  assert.deepEqual(gateItemMissing(next.inbox[0]), ['a one-line why', 'what it replaces or deletes']);
  const edited = editGateItem(next, 'a', { why: ' useful ', replaces: 'old', id: 'bad' });
  assert.deepEqual(gateItemMissing(edited.inbox[0]), []);
  assert.equal(edited.inbox[0].id, 'a');
  assert.equal(next.inbox[0].why, '');
  assert.equal(state.inbox.length, 0);
  assert.equal(deleteGateItem(edited, 'a').inbox.length, 0);
  assert.throws(() => editGateItem(state, 'missing', {}), code('item-missing'));
  assert.throws(() => captureGateItem(state, { kind: 'bug', text: ' ' }, { now, id: 'b' }), code('empty-item'));
});
test('tracked hours include the boundary and exclude older or incomplete records', () => {
  assert.equal(trackedHoursSince([{ completedAt: new Date(+now - 1), sessionDuration: DAY }, { completedAt: now, sessionDuration: DAY / 24 }, { sessionDuration: DAY }], now), 1);
});
test('opening requires all three conditions', () => {
  const tasks = [{ completedAt: now, sessionDuration: 40 * DAY / 24 }];
  const state = capture(createGateState(now));
  for (const conditions of [gateConditions(state, { completedTasks: [], now: later }), gateConditions(state, { completedTasks: tasks, now }), gateConditions(createGateState(now), { completedTasks: tasks, now: later })]) {
    assert.equal(conditions.allMet, false);
    assert.throws(() => openGateWindow(state, { conditions, now: later }), code('not-earned'));
  }
  const next = openGateWindow(state, { conditions: gateConditions(state, { completedTasks: tasks, now: later }), now: later });
  assert.equal(next.window.release, 0);
  assert.equal(+new Date(next.window.endsAt) - +later, 7 * DAY);
  assert.throws(() => openGateWindow(next, { conditions: { allMet: true }, now: later }), code('window-open'));
});
test('today lock uses local end of day and excludes finished/deleted/archived tasks', () => {
  const local = new Date(2026, 9, 12, 9);
  const due = new Date(2026, 9, 12, 23, 59, 59, 999).toISOString();
  assert.deepEqual(todayLock([{ name: 'Today', dueDate: due }, { name: 'Past', dueDate: new Date(2026, 9, 11) }, { dueDate: new Date(2026, 9, 13) }, ...['completedAt','deletedAt','archivedAt'].map((key) => ({ dueDate: due, [key]: due })), {}], local), { locked: true, count: 2, names: ['Today','Past'] });
});
test('verify requires at least one check and all checks ticked', () => {
  const state = verify();
  assert.throws(() => advanceGateItem(state, 'a'), code('checks-open'));
  const checked = addGateCheck(state, 'a', 'Works', { checkId: 'c' });
  assert.throws(() => advanceGateItem(checked, 'a'), code('checks-open'));
  assert.equal(done().window.items[0].step, 'done');
  assert.equal(state.window.items[0].checks.length, 0);
  assert.throws(() => addGateCheck(state, 'a', ' ', { checkId: 'c' }), code('empty-check'));
});
test('release ships done items and strips payment metadata from returned items', () => {
  let state = capture(done(), 'b', 'add');
  state = lockGateItem(state, 'b', { ledgerUUID: 'second' }).state;
  const shipped = releaseGateWindow(state, { name: 'Gate', notes: 'Ready', now: later });
  assert.equal(shipped.releases[0].items.length, 1);
  assert.equal(shipped.installedRelease, 0);
  assert.equal(shipped.window, null);
  assert.equal(shipped.lastReleaseAt, later.toISOString());
  for (const key of ['price','ledgerUUID','step','checks']) assert.equal(key in shipped.inbox[0], false);
  assert.equal(state.window.items.length, 2);
  assert.throws(() => releaseGateWindow(locked(), { name: 'Gate', now: later }), code('nothing-done'));
  assert.throws(() => releaseGateWindow(done(), { name: ' ', now: later }), code('missing-name'));
});
test('locking caps the window at three and returning allows a new paid lock', () => {
  let state = opened();
  for (const id of ['b','c','d']) state = capture(state, id, 'add');
  for (const id of ['a','b','c']) state = lockGateItem(state, id, { ledgerUUID: id }).state;
  assert.throws(() => lockGateItem(state, 'd', { ledgerUUID: 'd' }), code('window-full'));
  const returned = returnGateItem(state, 'b');
  assert.equal('price' in returned.inbox.find((item) => item.id === 'b'), false);
  assert.equal(lockGateItem(returned, 'b', { ledgerUUID: 'new' }).price, 60);
});
test('prompts name rules, branch and approved note paths', () => {
  const state = locked();
  const item = state.window.items[0];
  assert.match(buildDesignPrompt(item, 0), /AGENTS\.md/);
  assert.match(buildDesignPrompt(item, 0), /no code/);
  assert.match(buildDesignPrompt(item, 0), /docs\/releases\/v0\/fix-a\.md/);
  assert.doesNotMatch(buildBuildPrompt(state.window), /fix-a\.md/);
  const prompt = buildBuildPrompt(advanceGateItem(state, 'a').window);
  for (const text of ['AGENTS.md','release/v0','docs/releases/v0/fix-a.md','one commit per item','run npm test','list the hand checks']) assert.ok(prompt.includes(text));
  assert.equal(slug(' !!! '), 'item');
  assert.ok(slug('A'.repeat(90)).length <= 48);
});
