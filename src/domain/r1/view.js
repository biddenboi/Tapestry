import { DAY, EPS, fdiv } from '@domain/r1/params.js';
import { lag, plen, shortRow, ownerOf } from '@domain/r1/decide.js';
// Rust lib.rs:1034-1099. The allowed alternatives use plain deadline slack.
export function view(m, now) {
  m.roll(now); const day = fdiv(now); const [mean, sd] = m.forecast(now); const [insts, rate, he] = m.instances(now); const pl = m.slack(now, insts, rate, he, true); const items = [];
  m.items.forEach((it, k) => {
    if (it.removed) return; const pending = m.pending(k); const r = m.windowStart(it); const w = m.wOf(k); const stated = m.rOf(k); const rEff = m.reff(k);
    const row = { id: it.id, window_start: r, start: it.start, held_until: (m.holds.get(it.id) ?? -Infinity) > now + EPS ? m.holds.get(it.id) : null, deadline: it.d, released: r <= now + EPS, pending, done: it.done, habit: it.habit, cycle: it.cycle, category: it.category, worked: w, remaining: stated, planning_remaining: rEff, suggested_today: pending ? Math.max(0, lag(m, { item: k, r, d: it.d, rEff, w, current: true }, now)) : 0, even_pace_per_day: pending && it.d > now ? rEff / Math.max(1, Math.ceil((it.d - now) / DAY - EPS)) : 0, overdue: it.cycle == null && !it.done && it.d <= now, used_up: !it.done && !it.habit && stated <= EPS, start_now: null, blocked_by: null };
    const i = insts.find((i) => i.current && i.item === k && i.r <= now + EPS);
    if (i) { const ell = plen(m, i); const b = shortRow(pl, i.d, ell); if (b == null) row.start_now = ell; else row.blocked_by = ownerOf(m, insts, b); }
    items.push(row);
  });
  const disc = [...m.rewards, ['rest', m.rest]].map(([name, desired]) => { const taken = m.dlogs.get(JSON.stringify([day, name])) || 0; const left = Math.min(desired - taken, m.p.s); const b = left > EPS ? shortRow(pl, Infinity, left) : null; return { name, desired, taken, start_now: left > EPS && b == null ? left : null, blocked_by: b == null ? null : ownerOf(m, insts, b) }; });
  return { forecast_mean: mean, forecast_sd: sd, logged_today: m.dayTotal.get(day) || 0, today_remaining: m.todayRemaining(now), items, disc };
}
