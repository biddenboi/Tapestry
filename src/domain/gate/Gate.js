import { DAY } from '@domain/constants.js';
import { expectedRewardCoins } from '@domain/rewards/RewardSchedule.js';

export const GATE_SETTING_ID = 'gate.state';
export const GATE_SCHEMA_VERSION = 1;
export const GATE_RULES = Object.freeze({ useHours: 40, daysBetweenReleases: 21, windowDays: 7, maxItemsPerRelease: 3 });
export const GATE_KINDS = Object.freeze(['bug', 'change', 'add', 'remove']);
export const GATE_STEPS = Object.freeze(['design', 'build', 'verify', 'done']);

export class GateError extends Error {
  constructor(code) { super(code); this.name = 'GateError'; this.code = code; }
}
const clean = (value) => String(value ?? '').trim();
const iso = (now) => new Date(now).toISOString();
const inboxItem = ({ id, kind, text, why, replaces, capturedAt }) => ({ id, kind, text, why, replaces, capturedAt });

export function gateItemPrice(kind) {
  if (!GATE_KINDS.includes(kind)) throw new GateError('unknown-kind');
  return Math.round(({ add: 20, change: 10, remove: 5, bug: 0 })[kind] * expectedRewardCoins('task'));
}
export function createGateState(now) {
  return { schemaVersion: GATE_SCHEMA_VERSION, lastReleaseAt: iso(now), installedRelease: null, inbox: [], window: null, releases: [] };
}
export function normalizeGateState(value, now) {
  return value?.schemaVersion === GATE_SCHEMA_VERSION ? structuredClone(value) : createGateState(now);
}
export function gateItemMissing(item) {
  return [!clean(item.why) && 'a one-line why', item.kind === 'add' && !clean(item.replaces) && 'what it replaces or deletes'].filter(Boolean);
}
export const isGateItemReady = (item) => gateItemMissing(item).length === 0;
export function captureGateItem(state, { kind, text, why, replaces }, { now, id }) {
  gateItemPrice(kind);
  if (!clean(text)) throw new GateError('empty-item');
  return { ...state, inbox: [...state.inbox, { id, kind, text: clean(text), why: clean(why), replaces: clean(replaces), capturedAt: iso(now) }] };
}
export function editGateItem(state, id, patch) {
  if (!state.inbox.some((item) => item.id === id)) throw new GateError('item-missing');
  return { ...state, inbox: state.inbox.map((item) => {
    if (item.id !== id) return item;
    const updated = { ...item };
    for (const key of ['kind', 'text', 'why', 'replaces']) if (key in patch) updated[key] = clean(patch[key]);
    gateItemPrice(updated.kind);
    if (!updated.text) throw new GateError('empty-item');
    return updated;
  }) };
}
export function deleteGateItem(state, id) {
  if (!state.inbox.some((item) => item.id === id)) throw new GateError('item-missing');
  return { ...state, inbox: state.inbox.filter((item) => item.id !== id) };
}
export function trackedHoursSince(completedTasks, since) {
  return completedTasks.reduce((sum, task) => {
    const duration = Number(task.sessionDuration);
    return task.completedAt && new Date(task.completedAt).getTime() >= new Date(since).getTime()
      && Number.isFinite(duration) ? sum + Math.max(0, duration) : sum;
  }, 0) / (DAY / 24);
}
export function gateConditions(state, { completedTasks = [], now }) {
  const hours = trackedHoursSince(completedTasks, state.lastReleaseAt);
  const elapsed = Math.max(0, (new Date(now) - new Date(state.lastReleaseAt)) / DAY);
  const ready = state.inbox.filter(isGateItemReady).length;
  const use = { hours, needed: GATE_RULES.useHours, met: hours >= GATE_RULES.useHours };
  const days = { elapsed, needed: GATE_RULES.daysBetweenReleases, met: elapsed >= GATE_RULES.daysBetweenReleases };
  const inbox = { ready, met: ready > 0 };
  return { use, days, inbox, allMet: use.met && days.met && inbox.met };
}
export function todayLock(todos, now, r1 = null) {
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const open = todos.filter((todo) => !todo.completedAt && !todo.deletedAt && !todo.archivedAt && todo.dueDate && new Date(todo.dueDate) <= end);
  return { locked: open.length > 0 || r1?.mode === 'margin', count: open.length, names: open.map((todo) => todo.name || todo.title || 'Untitled task'), ...(r1 ? { margin: r1.mode === 'margin' } : {}) };
}
export function openGateWindow(state, { conditions, now }) {
  if (state.window) throw new GateError('window-open');
  if (!conditions.allMet) throw new GateError('not-earned');
  return { ...state, window: { release: state.releases.length, openedAt: iso(now), endsAt: iso(new Date(now).getTime() + GATE_RULES.windowDays * DAY), items: [] } };
}
export function lockGateItem(state, id, { ledgerUUID, estimateMinutes = null }) {
  if (!state.window) throw new GateError('window-closed');
  if (state.window.items.length >= GATE_RULES.maxItemsPerRelease) throw new GateError('window-full');
  const item = state.inbox.find((entry) => entry.id === id);
  if (!item) throw new GateError('item-missing');
  if (!isGateItemReady(item)) throw new GateError('item-not-ready');
  const price = gateItemPrice(item.kind);
  return { price, state: { ...state, inbox: state.inbox.filter((entry) => entry.id !== id), window: { ...state.window, items: [...state.window.items, { ...item, price, ledgerUUID, ...(estimateMinutes == null ? {} : { estimateMinutes }), step: 'design', checks: [] }] } } };
}
function updateWindowItem(state, id, transform) {
  if (!state.window) throw new GateError('window-closed');
  if (!state.window.items.some((item) => item.id === id)) throw new GateError('item-missing');
  return { ...state, window: { ...state.window, items: state.window.items.map((item) => item.id === id ? transform(item) : item) } };
}
export function advanceGateItem(state, id) {
  return updateWindowItem(state, id, (item) => {
    if (item.step === 'verify' && (!item.checks.length || item.checks.some((check) => !check.done))) throw new GateError('checks-open');
    return { ...item, step: GATE_STEPS[Math.min(GATE_STEPS.indexOf(item.step) + 1, GATE_STEPS.length - 1)] };
  });
}
export function addGateCheck(state, id, text, { checkId }) {
  if (!clean(text)) throw new GateError('empty-check');
  return updateWindowItem(state, id, (item) => ({ ...item, checks: [...item.checks, { id: checkId, text: clean(text), done: false }] }));
}
export function toggleGateCheck(state, id, checkId) {
  return updateWindowItem(state, id, (item) => ({ ...item, checks: item.checks.map((check) => check.id === checkId ? { ...check, done: !check.done } : check) }));
}
export function returnGateItem(state, id) {
  const checked = updateWindowItem(state, id, (item) => item);
  const item = checked.window.items.find((entry) => entry.id === id);
  return { ...state, inbox: [...state.inbox, inboxItem(item)], window: { ...state.window, items: state.window.items.filter((entry) => entry.id !== id) } };
}
export function releaseGateWindow(state, { name, notes, now }) {
  if (!state.window) throw new GateError('window-closed');
  const done = state.window.items.filter((item) => item.step === 'done');
  if (!done.length) throw new GateError('nothing-done');
  if (!clean(name)) throw new GateError('missing-name');
  const releasedAt = iso(now);
  const release = { number: state.window.release, name: clean(name), notes: clean(notes), openedAt: state.window.openedAt, releasedAt,
    items: done.map(({ kind, text, why, replaces, price }) => ({ kind, text, why, replaces, price })) };
  return { ...state, lastReleaseAt: releasedAt, installedRelease: release.number, window: null,
    inbox: [...state.inbox, ...state.window.items.filter((item) => item.step !== 'done').map(inboxItem)], releases: [release, ...state.releases] };
}
