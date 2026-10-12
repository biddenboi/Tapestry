import { DAY, EPS, fdiv, vmin, argmin, cmp3 } from '@domain/r1/params.js';
// Rust lib.rs:794-820.
export function lag(m, i, now) { return m.ent(m.entry(i.item), i.w + i.rEff, DAY * (fdiv(now) + 1)) - i.w; }
export const id = (m, i) => m.items[i.item].id;
export const plen = (m, i) => m.items[i.item].habit ? Math.min(m.p.s, i.rEff) : m.p.s;
export function shortRow(rows, d, ell) { const k = rows.b.findIndex((b, i) => b < d - EPS && rows.now[i] < ell - EPS); return k < 0 ? null : rows.b[k]; }
// Rust lib.rs:821-835.
export function ownerOf(m, insts, b) { const at = insts.filter((i) => Math.abs(i.d - b) <= EPS); const i = at.find((i) => i.current) || at[0]; return i ? id(m, i) : null; }
export const legal = (m, i, rows) => shortRow(rows, i.d, plen(m, i)) == null;
// Rust lib.rs:1102-1144.
export function habitPace(m, now, ok, pl) {
  if (!m.p.habitPacing || m.p.policy !== 'r1') return null;
  const eod = DAY * (fdiv(now) + 1);
  const hab = ok.filter((i) => m.items[i.item].habit && i.rEff > EPS && i.d <= eod + EPS).filter((i) => vmin(pl.now.filter((_, k) => pl.b[k] <= i.d + EPS)) >= -EPS);
  if (!hab.length) return null;
  const pick = hab.reduce((a, b) => cmp3([a.rEff, 0, id(m, a)], [b.rEff, 0, id(m, b)]) <= 0 ? b : a);
  const used = m.dayTotal.get(fdiv(now)) || 0; const expd = Math.max(used + m.todayRemaining(now), m.p.s); let tot = 0; let wdone = 0;
  m.items.forEach((it, k) => { if (it.habit && !it.done && !it.removed && it.cycle != null && it.cycle <= DAY + EPS) { tot += it.q; wdone += Math.min(m.wOf(k), it.q); } });
  const ell = plen(m, pick); return tot * Math.min((used + ell / 2) / expd, 1) - wdone >= ell / 2 - EPS ? pick : null;
}
// Rust lib.rs:1146-1157.
export function sameCategory(m, pool, cat) { if (cat != null) { const same = pool.filter(([i]) => m.items[i.item].category === cat); if (same.length) return same; } return pool; }
// Rust lib.rs:1159-1175.
export function edf(m, choices, currentId, now) {
  const dmin = vmin(choices.map((i) => i.d)); const current = choices.find((i) => id(m, i) === currentId && i.d <= dmin + EPS); if (current) return current;
  return choices.map((i) => [i, lag(m, i, now)]).sort(([x, lx], [y, ly]) => cmp3([x.d, -lx, id(m, x)], [y.d, -ly, id(m, y)]))[0][0];
}
// Rust lib.rs:1179-1203.
export function discChoice(m, day, cap) {
  let best = null;
  for (const [name, want] of [...m.rewards, ['rest', m.rest]]) {
    if (want <= EPS) continue; const left = want - (m.dlogs.get(JSON.stringify([day, name])) || 0);
    if (left > EPS && (!best || left / want > best.share || (left / want === best.share && name > best.name))) best = { name, left, share: left / want };
  }
  return best ? [best.name === 'rest' ? 'rest' : 'reward', best.name, Math.min(best.left, m.p.s, cap)] : null;
}
// Rust lib.rs:1205-1235.
export function extraChoice(m, now, currentId, currentCat) {
  let hs = m.items.map((_, k) => k).filter((k) => { const it = m.items[k]; return it.habit && !it.done && !it.removed && !m.pending(k) && m.windowStart(it) <= now + EPS; });
  if (!hs.length) return null; const current = hs.find((k) => m.items[k].id === currentId); if (current != null) return m.items[current].id;
  if (currentCat != null) { const same = hs.filter((k) => m.items[k].category === currentCat); if (same.length) hs = same; }
  hs.sort((x, y) => cmp3([m.wOf(x) / Math.max(m.items[x].q, EPS), 0, m.items[x].id], [m.wOf(y) / Math.max(m.items[y].q, EPS), 0, m.items[y].id]));
  return m.items[hs[0]].id;
}
// Rust lib.rs:839-843. Mutates only replay-derived rolling windows/ledger/holds.
export function decideWith(state, now, windowEnd = null, params = null) {
  if (params) state.p = { ...state.p, ...params };
  state.module2(now, windowEnd); return decideAt(state, now);
}
// Rust lib.rs:845-1023, same rule order and tie-breaking as Lot.
export function decideAt(m, now) {
  const s = m.p.s; m.roll(now); const [insts, rate, he] = m.instances(now); const day = fdiv(now);
  const currentId = m.lastWork?.[0] === day ? m.lastWork[1] : null; const currentCat = m.items[m.index.get(currentId)]?.category ?? null;
  const alerts = []; const prompts = []; const pl = m.slack(now, insts, rate, he, true);
  if (pl.now.length && vmin(pl.now) < -EPS) { const j = argmin(pl.now); alerts.push({ alert: 'overload', from: now, to: pl.b[j], short: -pl.now[j] }); }
  if (pl.futMin < -EPS) alerts.push({ alert: 'overload', from: pl.futArg[0], to: pl.futArg[1], short: -pl.futMin });
  m.items.forEach((it, k) => { if (it.removed) return; if (!it.done && it.cycle == null && it.d <= now) alerts.push({ alert: 'overdue', id: it.id }); if (!it.done && !it.habit && m.rOf(k) <= EPS) prompts.push(it.id); });
  const released = insts.filter((i) => i.current && i.r <= now + EPS);
  const mk = (kind, target, length, rule, mode = 'normal', basis = 'idle') => ({ kind, ref: target, length, rule, mode, alerts: [...alerts], prompts: [...prompts], basis });
  const work = (i, rule, mode, basis) => mk('work', id(m, i), plen(m, i), rule, mode, basis);
  const disc = discChoice(m, day, Infinity); const extra = extraChoice(m, now, currentId, currentCat);
  const idle = (rule) => disc ? mk(...disc, rule) : extra ? mk('extra', extra, s, rule) : mk('free', null, 0, rule);
  if (m.p.policy === 'edf') return released.length ? work(edf(m, released, currentId, now), 'edf', 'normal', '') : idle('edf-idle');
  if (!released.length) return idle('1-none-released');
  const protect = (rows, rule, mode, basis) => {
    const safe = released.filter((i) => legal(m, i, pl));
    if (safe.length) { const dmin = vmin(safe.map((i) => i.d)); const habit = habitPace(m, now, safe.filter((i) => i.d <= dmin + EPS), pl); return habit ? work(habit, `${rule}-habit-pooled`, mode, basis) : work(edf(m, safe, currentId, now), rule, mode, basis); }
    const next = vmin(insts.map((i) => i.r).filter((r) => r > now + EPS)); const room = Math.min(vmin(rows.now), vmin(pl.now));
    if (Number.isFinite(next) && next - now <= room + EPS) { const w = next - now; const d = discChoice(m, day, w); return d ? mk(...d, `${rule}-wait`, mode, 'protect') : mk('wait', null, w, `${rule}-wait`, mode, 'protect'); }
    return work(edf(m, released, currentId, now), rule, mode, basis);
  };
  const sl = m.slack(now, insts, rate, he, false);
  if (sl.now.length && vmin(sl.now) < -EPS) return protect(pl, '2-margin-edf', 'margin', pl.now.length && vmin(pl.now) < -EPS ? 'shortfall' : 'precaution');
  const ok = released.filter((i) => legal(m, i, sl)); const lags = ok.map((i) => lag(m, i, now));
  const dueBasis = (i) => i.rEff / Math.max(1, Math.ceil((i.d - now) / DAY - EPS)) >= Math.min(s / 2, i.rEff) - EPS ? 'deadline-pace' : 'early-guide';
  const habit = habitPace(m, now, ok, pl); if (habit) return work(habit, '3-habit-pooled', 'normal', 'deadline-pace');
  const due = ok.map((i, k) => [i, lags[k]]).filter(([i, l]) => l >= Math.min(s / 2, i.rEff) - EPS);
  if (due.length) { const current = due.find(([i]) => id(m, i) === currentId); if (current) return work(current[0], '3-due-continue', 'normal', dueBasis(current[0])); const pool = sameCategory(m, due, currentCat); pool.sort(([x, lx], [y, ly]) => cmp3([x.d, -lx, id(m, x)], [y.d, -ly, id(m, y)])); return work(pool[0][0], '3-due', 'normal', dueBasis(pool[0][0])); }
  const gmin = vmin(sl.now); const pmin = vmin(pl.now);
  if (m.p.habitExtraOnce && disc?.[0] === 'reward') {
    const left = m.rest - (m.dlogs.get(JSON.stringify([day, 'rest'])) || 0);
    if (left > EPS && gmin >= Math.min(left, s) - EPS) return mk('rest', 'rest', Math.min(left, s), '4-rest-first');
    if (extra) { const ex = m.extraLogs.get(JSON.stringify([day, m.index.get(extra)])) || 0; if (ex < s - EPS && gmin >= s - EPS) return mk('extra', extra, s, '5-habit-extra-first'); }
  }
  if (disc && gmin >= disc[2] - EPS) return mk(...disc, '4-discretionary');
  const held = disc && pmin >= disc[2] - EPS ? 'precaution' : 'ahead';
  if (extra && gmin >= s - EPS) return mk('extra', extra, s, '5-habit-extra');
  if (ok.length) {
    const pool = ok.map((i, k) => [i, lags[k]]); const current = pool.find(([i]) => id(m, i) === currentId); if (current) return work(current[0], '6-ahead-continue', 'normal', held);
    const same = sameCategory(m, pool, currentCat); same.sort(([x, lx], [y, ly]) => cmp3([lx, -x.d, id(m, x)], [ly, -y.d, id(m, y)])); return work(same.at(-1)[0], '6-ahead', 'normal', held);
  }
  return protect(sl, '7-guard', 'normal', 'protect');
}
