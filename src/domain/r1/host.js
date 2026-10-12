import { replay } from '@domain/r1/state.js';
import { view } from '@domain/r1/view.js';
const TOL = 1 / 60;
// Lot src-tauri/src/model.rs:252-384. Caller passes the replayed model so logs
// and rolled repeating windows participate in the diff, not just saved fields.
export function syncFacts(previousFacts, currentFacts, now, { state = null, live = null } = {}) {
  const previous = new Map(previousFacts.map((f) => [f.id, f]));
  const m = state || replay(previousFacts.map((f) => ({ ev: 'add', id: f.id, now, q: f.q, d: f.d, start: f.start, cycle: f.cycle, habit: f.habit, category: f.category })));
  const views = new Map(view(m, now).items.map((i) => [i.id, i])); const seen = new Set(); const out = [];
  const emit = (ev, id, fields = {}) => out.push({ ev, id, now, ...fields });
  for (const f of currentFacts) {
    seen.add(f.id); const fed = previous.get(f.id); const iv = views.get(f.id);
    const reshaped = !fed || fed.habit !== f.habit || fed.category !== f.category || ((fed.cycle == null) !== (f.cycle == null)) || Math.abs((fed.cycle || 0) - (f.cycle || 0)) > TOL;
    if (reshaped || !iv) {
      emit('add', f.id, { q: f.q, d: f.d, start: f.start, cycle: f.cycle, habit: f.habit, category: f.category });
      if (f.habit && f.l >= TOL) out.push({ ev: 'log', start: Math.max(f.cycle == null ? -Infinity : f.d - f.cycle, now - f.l), dur: f.l, kind: 'work', ref: f.id });
      else if (!f.habit && f.l > 0) emit('estimate', f.id, { q: f.q - f.l });
      if (Math.abs((fed?.block || 0) - f.block) > 0.5 / 60) emit('block', f.id, { block: f.block });
      if ((fed?.after ?? null) !== f.after) emit('after', f.id, { after: f.after });
      if (f.completed) emit('complete', f.id);
      continue;
    }
    if (Math.abs(fed.block - f.block) > 0.5 / 60) emit('block', f.id, { block: f.block });
    if (fed.after !== f.after) emit('after', f.id, { after: f.after });
    const ahead = f.cycle == null ? 0 : Math.max(0, Math.round((iv.deadline - f.d) / f.cycle)) * f.cycle;
    const want = f.start == null ? null : f.start + ahead;
    if ((want == null) !== (iv.start == null) || (want != null && Math.abs(want - iv.start) > TOL)) emit('start', f.id, { start: want });
    let sameWindow = true;
    if (f.cycle == null) {
      if (Math.abs(f.d - iv.deadline) > TOL) emit('deadline', f.id, { d: f.d });
      if (f.completed && !iv.done) emit('complete', f.id);
      if (!f.completed && iv.done) emit('reopen', f.id);
    } else {
      const diff = f.d - iv.deadline; const k = Math.round(diff / f.cycle);
      if (Math.abs(diff - k * f.cycle) > TOL || k < -1) emit('deadline', f.id, { d: f.d });
      else if (k >= 1) { sameWindow = false; if (iv.pending) emit('complete', f.id); }
      else if (k <= -1) sameWindow = false;
      else if (iv.done && !f.completed) emit('reopen', f.id);
    }
    if (!sameWindow || live === f.id) continue;
    if (f.habit) {
      if (Math.abs(fed.q - f.q) > 0.5 / 60) emit('estimate', f.id, { q: f.q });
      const more = f.l - iv.worked;
      if (more > TOL && f.l < f.q) out.push({ ev: 'log', start: now - more, dur: more, kind: 'work', ref: f.id });
      else if (more < -TOL) out.push({ ev: 'log', start: now, dur: more, kind: 'adjust', ref: f.id });
    } else if (Math.abs(f.q - f.l - iv.remaining) > TOL) emit('estimate', f.id, { q: f.q - f.l });
  }
  for (const f of previousFacts) if (!seen.has(f.id)) emit('remove', f.id);
  return out;
}
export function factsFromState(m) {
  return m.items.filter((it) => !it.removed).map((it) => ({ id: it.id, q: it.q, d: it.d, start: it.start, cycle: it.cycle, habit: it.habit, category: it.category, block: it.block, after: it.after, l: 0, completed: it.done }));
}
