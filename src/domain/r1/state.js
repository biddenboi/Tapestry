import { DAY, EPS, DEFAULT_PARAMS, fdiv, vmin, argmin, unique, searchRight, sum, clamp, erfc } from '@domain/r1/params.js';
import { validateEvent } from '@domain/r1/events.js';

// Rust lot-r1 lib.rs:223-319.
export class R1State {
  constructor(params = {}, discretionary = {}) {
    this.p = { ...DEFAULT_PARAMS, ...params };
    this.rewards = Object.entries(discretionary.rewards || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    this.rest = discretionary.rest || 0;
    this.items = []; this.index = new Map(); this.ilogs = [];
    this.dlogs = new Map(); this.dayTotal = new Map(); this.extraLogs = new Map();
    this.firstDay = null; this.ledger = new Map(); this.missed = []; this.lastWork = null;
    this.forecastOverride = null; this.holds = new Map(); this.freshHolds = [];
  }
  // Rust lib.rs:323-355.
  addItem(id, now, q, d, start = null, cycle = null, habit = false, category = null) {
    cycle = cycle || null;
    const it = { id, q, qTime: cycle && habit ? d - cycle : now, d, created: now, start, cycle, habit, category, done: false, qc: cycle && !habit ? q : null, cycleNo: 0, removed: false, block: 0, after: null };
    if (this.index.has(id)) {
      const k = this.index.get(id); it.block = this.items[k].block; it.after = this.items[k].after; this.items[k] = it;
      for (const key of this.ledger.keys()) if (JSON.parse(key)[0] === id) this.ledger.delete(key);
    } else { this.index.set(id, this.items.length); this.items.push(it); this.ilogs.push([]); }
    this.roll(now);
  }
  // Rust lib.rs:357-366.
  estimate(id, now, q) { this.roll(now); const k = this.index.get(id); if (k != null) this.change(k, now, (it) => { it.q = q; it.qTime = now; }); }
  // Rust lib.rs:367-372.
  setDeadline(id, now, d) { const k = this.index.get(id); if (k != null) { this.change(k, now, (it) => { it.d = d; }); this.roll(now); } }
  // Rust lib.rs:374-378.
  setStart(id, now, start) { const k = this.index.get(id); if (k != null) this.change(k, now, (it) => { it.start = start; }); }
  // Rust lib.rs:380-394.
  setBlock(id, block) { const k = this.index.get(id); if (k != null) this.items[k].block = Math.max(0, block); }
  setAfter(id, after) { const k = this.index.get(id); if (k != null) this.items[k].after = after; }
  hold(id, until) { this.holds.set(id, Math.max(this.holds.get(id) ?? -Infinity, until)); }
  takeHolds() { const holds = this.freshHolds; this.freshHolds = []; return holds; }
  // Rust lib.rs:382-417, Module 2 pre-step.
  module2(now, windowEnd) {
    this.items.forEach((it, k) => {
      if (it.done || it.removed || it.habit || it.cycle != null) return;
      let until = it.after != null && !this.items[this.index.get(it.after)]?.done ? now + this.p.depRecheck : null;
      if (until == null && windowEnd != null && it.block > 0 && windowEnd - now < Math.min(it.block, Math.max(0, this.reff(k))) - EPS) until = windowEnd;
      if (until != null && until > (this.holds.get(it.id) ?? -Infinity)) { this.holds.set(it.id, until); this.freshHolds.push([it.id, now, until]); }
    });
  }
  // Rust lib.rs:419-443.
  complete(id) { const k = this.index.get(id); if (k != null) this.items[k].done = true; }
  reopen(id, now) { this.roll(now); const k = this.index.get(id); if (k != null) this.items[k].done = false; }
  remove(id) { const k = this.index.get(id); if (k != null) this.items[k].removed = true; }
  advance(now) { this.roll(now); }
  // Rust lib.rs:445-477.
  log(start, dur, kind, target) {
    const day = fdiv(start); const k = this.index.get(target);
    if (kind === 'adjust') { if (k != null) this.ilogs[k].push([start, dur]); return; }
    if (this.firstDay == null) this.firstDay = day;
    this.dayTotal.set(day, (this.dayTotal.get(day) || 0) + dur);
    if (kind === 'work' || kind === 'extra') {
      if (k != null) { this.ilogs[k].push([start, dur]); if (kind === 'extra') { const key = JSON.stringify([day, k]); this.extraLogs.set(key, (this.extraLogs.get(key) || 0) + dur); } }
      this.lastWork = [day, target];
    } else { const key = JSON.stringify([day, target]); this.dlogs.set(key, (this.dlogs.get(key) || 0) + dur); }
  }
  // Rust lib.rs:481-536.
  windowStart(it) { return it.cycle != null ? Math.max(it.d - it.cycle, it.start ?? -Infinity) : it.start ?? it.created; }
  wOf(k) { const it = this.items[k]; const lo = it.cycle != null ? it.d - it.cycle : -Infinity; return sum(this.ilogs[k].filter(([st]) => st >= lo - EPS).map(([, d]) => d)); }
  lOf(k) { return sum(this.ilogs[k].filter(([st]) => st >= this.items[k].qTime - EPS).map(([, d]) => d)); }
  rOf(k) { return this.items[k].q - (this.items[k].habit ? this.wOf(k) : this.lOf(k)); }
  pending(k) { const it = this.items[k]; return !it.done && !it.removed && (!it.habit || this.rOf(k) > EPS); }
  reff(k) { const r = this.rOf(k); return this.items[k].habit ? Math.max(0, r) : r > EPS ? r : this.p.s; }
  tOf(k) { return this.wOf(k) + this.reff(k); }
  key(k) { return JSON.stringify([this.items[k].id, this.items[k].cycleNo]); }
  // Rust lib.rs:538-566.
  entry(k) { const key = this.key(k); if (this.ledger.has(key)) return this.ledger.get(key); const it = this.items[k]; const r = this.windowStart(it); const e = { ta: it.cycle == null ? Math.max(r, it.created) : r, ea: 0, r, d: it.d }; this.ledger.set(key, e); return e; }
  ent(e, total, t) { const end = e.r + this.p.pace * (e.d - e.r); if (end <= e.ta + EPS) return total; return Math.min(total, e.ea + (total - e.ea) * clamp((t - e.ta) / (end - e.ta), 0, 1)); }
  // Rust lib.rs:568-583.
  change(k, now, mutate) { if (this.items[k].done || !this.pending(k)) { mutate(this.items[k]); return; } const old = this.ent(this.entry(k), this.tOf(k), now); mutate(this.items[k]); const r = this.windowStart(this.items[k]); this.ledger.set(this.key(k), { ta: Math.max(now, r), ea: Math.min(old, this.tOf(k)), r, d: this.items[k].d }); }
  // Rust lib.rs:585-612.
  roll(now) {
    this.items.forEach((it, k) => {
      if (it.cycle == null || it.removed) return;
      while (now >= it.d - EPS) {
        if (!it.done && (!it.habit || this.rOf(k) > EPS)) this.missed.push({ id: it.id, d: it.d, habit_floor: it.habit });
        it.d += it.cycle; if (this.p.shiftStart && it.start != null) it.start += it.cycle;
        it.cycleNo += 1; it.done = false; it.qTime = it.d - it.cycle; if (!it.habit) it.q = it.qc ?? it.q;
      }
    });
  }
  // Rust lib.rs:614-640.
  forecast(now) {
    if (this.forecastOverride) return this.forecastOverride;
    const p = this.p; const today = fdiv(now); const lam = Math.pow(0.5, 1 / p.halfLife); const xs = [];
    if (this.firstDay != null) for (let d = this.firstDay; d < today; d++) { const v = this.dayTotal.get(d) || 0; if (p.emptyDays === 'zero' || v > EPS) xs.push(v); }
    const n = xs.length; const wp = p.w0 * Math.pow(lam, n); const ws = xs.map((_, i) => Math.pow(lam, n - 1 - i)); const wt = wp + sum(ws);
    const mean = (wp * p.m0 + sum(xs.map((x, i) => ws[i] * x))) / wt;
    const variance = (wp * p.sd0 * p.sd0 + sum(xs.map((x, i) => ws[i] * (x - mean) * (x - mean)))) / wt;
    return [mean, Math.sqrt(variance)];
  }
  // Rust lib.rs:642-663.
  todayRemaining(now) {
    const [f, sd] = this.forecast(now); const used = this.dayTotal.get(fdiv(now)) || 0; const mid = DAY * (fdiv(now) + 1); let rem;
    if (sd <= EPS || this.p.todayRule === 'naive') rem = Math.max(0, f - used);
    else { const a = (used - f) / sd; const tail = 0.5 * erfc(a / Math.SQRT2); const pdf = Math.exp(-0.5 * a * a) / Math.sqrt(2 * Math.PI); rem = tail > 1e-12 ? f - used + sd * pdf / tail : sd / Math.max(a, 1); }
    return Math.min(Math.max(0, rem), mid - now);
  }
  desiredTotal() { return sum(this.rewards.map(([, v]) => v)) + this.rest; }
  // Rust lib.rs:669-704.
  instances(now) {
    const mid = DAY * (fdiv(now) + 1); const he = DAY * fdiv(now) + this.p.horizonDays * DAY; const out = []; let rate = 0;
    this.items.forEach((it, k) => {
      if (this.pending(k)) { let r = this.windowStart(it); const u = this.holds.get(it.id); if (u > now + EPS) r = Math.max(r, u); out.push({ item: k, r, d: it.d > now ? it.d : mid, rEff: this.reff(k), w: this.wOf(k), current: true }); }
      if (it.cycle != null && !it.removed) { const q = it.habit ? it.q : it.qc ?? it.q; for (let j = 1; it.d + j * it.cycle <= he + EPS; j++) { const ws = it.d + (j - 1) * it.cycle; const shift = this.p.shiftStart ? j * it.cycle : 0; const r = it.start == null ? ws : Math.max(ws, it.start + shift); out.push({ item: k, r, d: it.d + j * it.cycle, rEff: q, w: 0, current: false }); } rate += q / (it.cycle / DAY); }
    }); return [out, rate, he];
  }
  // Rust lib.rs:712-790.
  slack(now, insts, rate, he, plain) {
    const s = this.p.s; const [f, sd] = this.forecast(now); const reserve = plain ? 0 : this.desiredTotal(); const kA = plain ? 0 : this.p.kA;
    if (!insts.length) return { b: [], now: [], futMin: Infinity, futArg: null };
    const r = insts.map((i) => Math.max(i.r, now)); const dd = insts.map((i) => i.d); const rr = insts.map((i) => i.rEff);
    const mid = DAY * (fdiv(now) + 1); const kk = Math.max(1, Math.ceil((Math.max(...dd) - mid) / DAY) + 1);
    const caps = Array.from({ length: kk }, (_, j) => Math.max(0, f - reserve - (mid + DAY * j >= he - EPS ? rate : 0)));
    let c0 = this.todayRemaining(now); const days = [[now, mid, c0], ...caps.map((c, j) => [mid + DAY * j, mid + DAY * (j + 1), c])];
    days.forEach(([lo, hi, capacity], k) => { let c = capacity; if (EPS < c && c < s - EPS) for (let n = 0; n < insts.length; n++) if (this.items[insts[n].item].habit && r[n] >= lo - EPS && dd[n] <= hi + EPS && EPS < rr[n] && rr[n] <= c + EPS) { c -= rr[n]; rr[n] = 0; } if (k === 0) { if (c0 < s - EPS) c0 = 0; } else if (caps[k - 1] < s - EPS) caps[k - 1] = 0; });
    const cum = [0]; caps.forEach((c) => cum.push(cum.at(-1) + c));
    const cap = (t) => { const today = Math.min(c0, Math.max(0, Math.min(t, mid) - now)); const j = clamp(Math.floor((t - mid) / DAY), 0, kk - 1); return today + (t > mid ? cum[j] + Math.min(caps[j], Math.max(0, t - (mid + DAY * j))) : 0); };
    const b = unique(dd); const order = dd.map((_, i) => i).sort((x, y) => dd[x] - dd[y]); const ds = order.map((i) => dd[i]); const cumR = [0]; order.forEach((i) => cumR.push(cumR.at(-1) + rr[i]));
    const margin = (a, bb) => kA * sd * Math.sqrt(Math.max(1, Math.floor((bb - EPS) / DAY) - Math.floor(a / DAY) + 1));
    const sNow = b.map((bb) => cap(bb) - cumR[searchRight(ds, bb)] - margin(now, bb));
    let futMin = Infinity; let futArg = null;
    for (const a of unique(r.filter((x) => x > now + EPS && x < he))) {
      const mo = r.map((_, i) => i).filter((i) => r[i] >= a - EPS).sort((x, y) => dd[x] - dd[y]); if (!mo.length) continue;
      const dm = mo.map((i) => dd[i]); const cm = [0]; mo.forEach((i) => cm.push(cm.at(-1) + rr[i])); const cb = b.filter((x) => x > a); if (!cb.length) continue;
      const ca = cap(a); const sl = cb.map((bb) => cap(bb) - ca - cm[searchRight(dm, bb)] - margin(a, bb)); const k = argmin(sl);
      if (sl[k] < futMin) { futMin = sl[k]; futArg = [a, cb[k]]; }
    } return { b, now: sNow, futMin, futArg };
  }
  // Rust lib.rs:1240-1258.
  apply(input) { const e = validateEvent(input); switch (e.ev) {
    case 'add': this.addItem(e.id, e.now, e.q, e.d, e.start, e.cycle, e.habit, e.category); break;
    case 'estimate': this.estimate(e.id, e.now, e.q); break;
    case 'deadline': this.setDeadline(e.id, e.now, e.d); break;
    case 'start': this.setStart(e.id, e.now, e.start); break;
    case 'complete': this.complete(e.id); break; case 'reopen': this.reopen(e.id, e.now); break; case 'remove': this.remove(e.id); break;
    case 'log': this.log(e.start, e.dur, e.kind, e.ref); break;
    case 'block': this.setBlock(e.id, e.block); break; case 'after': this.setAfter(e.id, e.after); break; case 'hold': this.hold(e.id, e.until); break;
  } return this; }
}
// Rust lot-model lib.rs:212-217.
export function replay(events, params, discretionary) { const state = new R1State(params, discretionary); for (const event of events) state.apply(event); return state; }
