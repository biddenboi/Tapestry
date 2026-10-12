import { STORES } from '@domain/constants.js';
import { replay } from '@domain/r1/state.js';
import { syncFacts, factsFromState } from '@domain/r1/host.js';
import { factsFromTodo } from '@domain/r1/facts.js';
import { eventAt, validateEvent } from '@domain/r1/events.js';
import { nextTaskOccurrence } from '@domain/tasks/TaskRecurrence.js';
import { toModelHours } from './R1Clock.js';

export const R1_REWARD_SETTING = 'r1.rewardMinutes';
export function todoFacts(todo, state) {
  const cycle = todo.recurrence || todo.repeatRule;
  const next = cycle && todo.dueDate ? nextTaskOccurrence(todo, new Date(todo.dueDate).getTime() - 1) : null;
  const cycleHours = next ? toModelHours(next) - toModelHours(todo.dueDate) : null;
  const k = state?.index.get(String(todo.UUID));
  return factsFromTodo({ ...todo, r1LoggedMinutes: k == null ? 0 : 60 * (todo.isHabit ? state.wOf(k) : state.lOf(k)) }, { toHours: toModelHours, cycleHours });
}
export async function loadR1State(db) {
  const [rows, setting] = await Promise.all([db.getAll(STORES.r1Event), db.get(STORES.appSetting, R1_REWARD_SETTING)]);
  const events = [...rows].sort((a, b) => a.seq - b.seq).filter((r) => r.payload?.ev).map((r) => r.payload);
  return replay(events, {}, { rewards: { reward: Math.max(0, Number(setting?.value ?? 20)) / 60 }, rest: 0.5 });
}
export function eventRecords(events, { seq = 0, sourceKey, parent = null, at = new Date().toISOString(), meta = null } = {}) {
  return events.map((event, i) => ({ UUID: `r1:${sourceKey}:${i}`, id: `r1:${sourceKey}:${i}`, seq: seq + i + 1, at: eventAt(event), type: event.ev, payload: validateEvent(event), parent, createdAt: at, sourceKey, ...(meta ? { meta } : {}) }));
}
export async function appendR1Events(db, events, { sourceKey = crypto.randomUUID(), parent = null, meta = null } = {}) {
  if (!events.length) return { changed: false };
  const rows = await db.getAll(STORES.r1Event);
  if (rows.some((r) => r.sourceKey === sourceKey)) return { duplicate: true };
  const records = eventRecords(events, { seq: Math.max(0, ...rows.map((r) => r.seq)), sourceKey, parent, meta });
  return db.commitAtomicMutation({ label: 'r1-append-events', operationId: `r1:${sourceKey}`, flush: true, puts: records.map((record) => ({ store: STORES.r1Event, record })) });
}
// Called by the database command boundary before the source mutation commits:
// todo facts and observed time are saved atomically with the source records.
export async function prepareR1Mutation(db, operations, sourceKey) {
  const relevant = operations.filter((op) => [STORES.todo, STORES.taskCompletionEvent, STORES.actionSession, STORES.transaction].includes(op.store));
  if (!relevant.length) return [];
  const rows = await db.getAll(STORES.r1Event);
  // Backfill initializes the model before live capture starts. No empty-history guesses.
  if (!rows.length || rows.some((r) => r.sourceKey === sourceKey)) return [];
  const m = await loadR1State(db); const events = []; const now = toModelHours(new Date());
  const emit = (event) => { events.push(event); m.apply(event); };
  const todos = new Map((await db.getAll(STORES.todo)).map((t) => [t.UUID, t]));
  for (const op of relevant) {
    const r = op.record;
    if (op.store === STORES.todo) { if (op.type === 'delete') todos.delete(op.UUID); else todos.set(r.UUID, r); }
    if (op.type !== 'put') continue;
    if (op.store === STORES.actionSession && r.endedAt && r.outcome !== 'active') {
      const prior = await db.get(STORES.actionSession, r.UUID);
      if (prior?.endedAt) continue;
      const dur = Math.max(0, Number(r.activeDurationMs || 0)) / 3600000;
      if (dur) emit({ ev: 'log', start: toModelHours(r.startedAt), dur, kind: ['work', 'extra', 'rest', 'reward', 'wait'].includes(r.sessionKind) ? r.sessionKind : 'work', ref: ['rest', 'reward', 'wait'].includes(r.sessionKind) ? r.sessionKind : String(r.targetUUID) });
    }
    if (op.store === STORES.taskCompletionEvent) {
      if (await db.get(STORES.taskCompletionEvent, r.UUID)) continue;
      const id = String(r.todoUUID || r.taskUUID);
      if (!r.actionSessionUUID && r.durationMs > 0) emit({ ev: 'log', start: toModelHours(r.completedAt) - r.durationMs / 3600000, dur: r.durationMs / 3600000, kind: 'work', ref: id });
      emit({ ev: 'complete', id, now: toModelHours(r.completedAt) });
    }
    if (op.store === STORES.transaction && r.type === 'shop_purchase' && !(await db.get(STORES.transaction, r.UUID))) {
      const item = await db.get(STORES.shop, r.itemUUID);
      if (item?.type === 'duration' && item.duration > 0) emit({ ev: 'log', start: toModelHours(r.createdAt), dur: Number(item.duration) * Math.max(1, Number(r.quantity || 1)) / 60, kind: 'reward', ref: 'reward' });
    }
  }
  if (relevant.some((o) => o.store === STORES.todo)) {
    const current = [...todos.values()].map((t) => todoFacts(t, m)).filter(Boolean);
    const diff = syncFacts(factsFromState(m), current, now, { state: m }); diff.forEach(emit);
  }
  return eventRecords(events, { seq: Math.max(0, ...rows.map((r) => r.seq)), sourceKey });
}
export async function recordR1Change(db, { sourceKey = crypto.randomUUID(), now = new Date() } = {}) {
  const m = await loadR1State(db); const facts = (await db.getAll(STORES.todo)).map((t) => todoFacts(t, m)).filter(Boolean);
  return appendR1Events(db, syncFacts(factsFromState(m), facts, toModelHours(now), { state: m }), { sourceKey });
}
