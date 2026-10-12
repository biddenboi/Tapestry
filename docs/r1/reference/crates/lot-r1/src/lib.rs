//! R1: Lot's selected next-task rule.
//!
//! This is a line-by-line port of the reference core `research/r1/r1.py`
//! (R1-spec.md, "final for use", 2026-10-05), with Module 2 of the final model
//! ("R1new + Module 2", final/1-model-description.md §1.5, §5, §8.1) and one
//! change Peter asked for: a repeating item's start date moves with its deadline
//! (`Params::shift_start`). Names follow the reference so the
//! two can be read side by side; section numbers refer to the spec. The parity
//! test in `tests/parity.rs` replays traces recorded from the Python reference
//! and requires identical decisions. When the reference changes, regenerate the
//! fixtures with `tools/r1-parity/gen.py` and port the diff here. Module 2 is
//! checked the same way against the lab's block/dependency code
//! (`tools/r1-parity/gen_m2.py`, `tests/module2.rs`).
//!
//! Time is in hours; day k is `[24k, 24k + 24)`. Inputs are only the
//! observable ones: Q, L (derived from the log), D, start, cycle, habit,
//! category, rewards, rest, the minimum session and the log itself.

use std::collections::HashMap;

use lot_model::{Alert, Basis, Decision, DecisionKind, Discretionary, Event, Hours, LogKind, Missed, Mode, Model};

pub const DAY: f64 = 24.0;
pub const EPS: f64 = 1e-9;

/// R1's defaults (§9). Only `s` is a user setting.
#[derive(Clone, Debug, PartialEq)]
pub struct Params {
    /// Minimum session length (h). User setting.
    pub s: f64,
    /// Pace endpoint: fraction of each window.
    pub pace: f64,
    /// Availability margin, in forecast standard deviations (Peter chose 2 on 2026-10-06).
    pub k_a: f64,
    /// Cold-start prior for daily directed hours.
    pub m0: f64,
    pub sd0: f64,
    /// Prior weight, in days of evidence.
    pub w0: f64,
    /// Forecast memory, days.
    pub half_life: f64,
    /// Explicit cycle instances and release-aware rows.
    pub horizon_days: i64,
    pub policy: Policy,
    pub today_rule: TodayRule,
    pub empty_days: EmptyDays,
    /// Module 2: re-check interval for an item whose predecessor is unfinished (h).
    pub dep_recheck: f64,
    /// A repeating item's start date moves with its deadline: if the deadline is k + n·c, the start
    /// is z + n·c (Peter, 2026-10-06). Off is r1.py's fixed start, which only limits the first window.
    pub shift_start: bool,
    /// Today's daily habit minimums are paced over the day as one pool: a habit wins a deadline tie
    /// once the pool is half a block behind its even share (Peter chose "pooled", 2026-10-11).
    /// Off is r1.py's order, where habits lose ties to the current task and pile up late.
    pub habit_pacing: bool,
    /// Free time order when a reward is next: rest first, then one extra session per habit per day,
    /// then rewards (2026-10-11). Off is r1.py's order: rewards and rest by share left, then habits.
    pub habit_extra_once: bool,
}

/// Days with no Lot activity: `Skip` (unobserved, final) or `Zero` (ablation only).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EmptyDays {
    Skip,
    Zero,
}

/// `Edf` is the strict reference (R0), kept as a second model behind the same interface.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Policy {
    R1,
    Edf,
}

/// `Naive` = max(0, f − used), the ablation only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TodayRule {
    Conditional,
    Naive,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            s: 1.0,
            pace: 2.0 / 3.0,
            k_a: 2.0,
            m0: 4.0,
            sd0: 1.5,
            w0: 3.0,
            half_life: 14.0,
            horizon_days: 28,
            policy: Policy::R1,
            today_rule: TodayRule::Conditional,
            empty_days: EmptyDays::Skip,
            dep_recheck: 0.5,
            shift_start: true,
            habit_pacing: false,
            habit_extra_once: false,
        }
    }
}

#[derive(Clone, Debug)]
struct Item {
    id: String,
    /// Remaining estimate stated at `q_time` (habit: floor per cycle).
    q: f64,
    q_time: f64,
    /// Deadline of the current window.
    d: f64,
    created: f64,
    start: Option<f64>,
    cycle: Option<f64>,
    habit: bool,
    category: Option<String>,
    done: bool,
    /// Per-cycle estimate of a repeating task, stored at cycle start.
    qc: Option<f64>,
    cycle_no: i64,
    /// Left Lot (not in r1.py): takes no part in any decision until re-added.
    removed: bool,
    /// Module 2: minimum contiguous block (h), one-off items only.
    block: f64,
    /// Module 2: an item that must be completed first, one-off items only.
    after: Option<String>,
}

type Key = (String, i64);

/// One obligation instance: a one-off item, or one cycle of a repeating item.
#[derive(Clone, Debug)]
struct Inst {
    /// Index into `items`.
    item: usize,
    r: f64,
    /// Deadline for ordering and feasibility (overdue → end of today).
    d: f64,
    /// R_eff.
    r_eff: f64,
    w: f64,
    current: bool,
}

/// Pacing ledger row (tₐ, Eₐ, r, D).
#[derive(Clone, Copy, Debug)]
struct Entry {
    ta: f64,
    ea: f64,
    r: f64,
    d: f64,
}

struct Slack {
    b: Vec<f64>,
    now: Vec<f64>,
    fut_min: f64,
    fut_arg: Option<(f64, f64)>,
}

/// One item as the interface sees it (hours on the model clock).
#[derive(Clone, Debug, PartialEq)]
pub struct ItemView {
    pub id: String,
    /// Start of the current window (one-off: its start date, or when it was first seen).
    pub window_start: f64,
    /// The start date in force for the current window (repeating: shifted with each cycle).
    pub start: Option<f64>,
    /// Module 2: held until this time (an unfinished predecessor, a block that doesn't fit, a decline).
    pub held_until: Option<f64>,
    /// The real deadline of the current window. The hidden pace endpoint is never exposed.
    pub deadline: f64,
    pub released: bool,
    /// Still owes work in the current window.
    pub pending: bool,
    pub done: bool,
    pub habit: bool,
    pub cycle: Option<f64>,
    pub category: Option<String>,
    /// Work logged inside the current window.
    pub worked: f64,
    /// Stated remaining (habit: floor minus window work).
    pub remaining: f64,
    pub planning_remaining: f64,
    /// Lot's suggestion for today (pace lag at the end of today), never below zero.
    pub suggested_today: f64,
    /// Even pacing to the real deadline, per day.
    pub even_pace_per_day: f64,
    pub overdue: bool,
    /// The estimate ran out before the item was finished.
    pub used_up: bool,
    /// If you may start it now, the session length (see [`R1::view`]); `None` if not.
    pub start_now: Option<f64>,
    /// When it can't start now only because of the guard: the item whose deadline it would leave short.
    pub blocked_by: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DiscView {
    /// A reward's name, or "rest".
    pub name: String,
    pub desired: f64,
    pub taken: f64,
    /// If you may start it now, the session length: what's left of today's desired time, at most one
    /// minimum session; `None` once it's met or when spending the time would leave a deadline short.
    pub start_now: Option<f64>,
    /// When spending the time now would leave a deadline short: that deadline's item.
    pub blocked_by: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct View {
    /// Forecast of daily logged time through Lot (not free time).
    pub forecast_mean: f64,
    pub forecast_sd: f64,
    pub logged_today: f64,
    pub today_remaining: f64,
    pub items: Vec<ItemView>,
    pub disc: Vec<DiscView>,
}

pub struct R1 {
    pub p: Params,
    rewards: Vec<(String, f64)>,
    rest: f64,
    items: Vec<Item>,
    index: HashMap<String, usize>,
    /// item index → [(start, dur)]
    ilogs: Vec<Vec<(f64, f64)>>,
    /// (day, name) → hours, for rewards and rest
    dlogs: HashMap<(i64, String), f64>,
    /// day → directed hours
    day_total: HashMap<i64, f64>,
    /// (day, item index) → hours of habit time beyond the floor
    extra_logs: HashMap<(i64, usize), f64>,
    first_day: Option<i64>,
    ledger: HashMap<Key, Entry>,
    missed: Vec<Missed>,
    /// (day, item id)
    last_work: Option<(i64, String)>,
    /// A fixed (mean, sd) forecast, for checks that control capacity exactly.
    pub forecast_override: Option<(f64, f64)>,
    /// Module 2 hold map: item id → time until which it is held.
    holds: HashMap<String, f64>,
    /// Holds the pre-step set since the last `take_holds`, as (id, at, until), for the event log.
    fresh_holds: Vec<(String, f64, f64)>,
}

fn fdiv(x: f64) -> i64 {
    (x / DAY).floor() as i64
}

fn argmin(v: &[f64]) -> usize {
    let mut k = 0;
    for (i, x) in v.iter().enumerate() {
        if *x < v[k] {
            k = i;
        }
    }
    k
}

fn vmin(v: &[f64]) -> f64 {
    v.iter().copied().fold(f64::INFINITY, f64::min)
}

/// Sorted unique values.
fn unique(mut v: Vec<f64>) -> Vec<f64> {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v.dedup();
    v
}

/// numpy searchsorted(sorted, x, side="right").
fn search_right(sorted: &[f64], x: f64) -> usize {
    sorted.partition_point(|v| *v <= x)
}

/// Lexicographic compare for selection keys.
fn cmp3(a: (f64, f64, &str), b: (f64, f64, &str)) -> std::cmp::Ordering {
    a.0.partial_cmp(&b.0)
        .unwrap()
        .then(a.1.partial_cmp(&b.1).unwrap())
        .then(a.2.cmp(b.2))
}

impl R1 {
    pub fn new(p: Params, disc: &Discretionary) -> Self {
        R1 {
            p,
            rewards: disc.rewards.iter().map(|(k, v)| (k.clone(), *v)).collect(),
            rest: disc.rest,
            items: vec![],
            index: HashMap::new(),
            ilogs: vec![],
            dlogs: HashMap::new(),
            day_total: HashMap::new(),
            extra_logs: HashMap::new(),
            first_day: None,
            ledger: HashMap::new(),
            missed: vec![],
            last_work: None,
            forecast_override: None,
            holds: HashMap::new(),
            fresh_holds: vec![],
        }
    }

    // ------------------------------------------------------------------ input events

    #[allow(clippy::too_many_arguments)]
    pub fn add_item(&mut self, id: &str, now: f64, q: f64, d: f64, start: Option<f64>, cycle: Option<f64>, habit: bool, category: Option<String>) {
        let cycle = cycle.filter(|c| *c != 0.0);
        let mut it = Item { id: id.into(), q, q_time: now, d, created: now, start, cycle, habit, category, done: false, qc: None, cycle_no: 0, removed: false, block: 0.0, after: None };
        if cycle.is_some() && !habit {
            it.qc = Some(q);
        }
        if let (Some(c), true) = (cycle, habit) {
            it.q_time = d - c;
        }
        match self.index.get(id) {
            // Re-adding replaces the item but keeps its log, as the reference does. Its old ledger rows
            // would describe a different item, so they go (the reference never re-adds).
            Some(&k) => {
                // Module 2 inputs are separate events; a re-add keeps them.
                it.block = self.items[k].block;
                it.after = self.items[k].after.take();
                self.items[k] = it;
                self.ledger.retain(|key, _| key.0 != id);
            }
            None => {
                self.index.insert(id.into(), self.items.len());
                self.items.push(it);
                self.ilogs.push(vec![]);
            }
        }
        self.roll(now);
    }

    pub fn estimate(&mut self, id: &str, now: f64, q: f64) {
        self.roll(now);
        let Some(&k) = self.index.get(id) else { return };
        self.change(k, now, |it| {
            it.q = q;
            it.q_time = now;
        });
    }

    pub fn set_deadline(&mut self, id: &str, now: f64, d: f64) {
        let Some(&k) = self.index.get(id) else { return };
        self.change(k, now, |it| it.d = d);
        self.roll(now);
    }

    pub fn set_start(&mut self, id: &str, now: f64, start: Option<f64>) {
        let Some(&k) = self.index.get(id) else { return };
        self.change(k, now, |it| it.start = start);
    }

    /// Module 2: minimum contiguous block, hours (0 = none).
    pub fn set_block(&mut self, id: &str, block: f64) {
        if let Some(&k) = self.index.get(id) {
            self.items[k].block = block.max(0.0);
        }
    }

    /// Module 2: the item that must be completed first.
    pub fn set_after(&mut self, id: &str, after: Option<String>) {
        if let Some(&k) = self.index.get(id) {
            self.items[k].after = after;
        }
    }

    /// Module 2: hold(i, u) sets H(i) ← max(H(i), u).
    pub fn hold(&mut self, id: &str, until: f64) {
        let h = self.holds.entry(id.to_string()).or_insert(f64::NEG_INFINITY);
        *h = h.max(until);
    }

    /// Holds the pre-step set since the last call, as (id, at, until).
    pub fn take_holds(&mut self) -> Vec<(String, f64, f64)> {
        std::mem::take(&mut self.fresh_holds)
    }

    /// Module 2 pre-step (§8.1), for each pending one-off non-habit item: an unfinished predecessor holds
    /// it for a short re-check interval; otherwise a block that doesn't fit in what is left of the
    /// current availability window (ending at `window_end`, when known) holds it until the window ends.
    fn module2(&mut self, now: f64, window_end: Option<f64>) {
        for k in 0..self.items.len() {
            let it = &self.items[k];
            if it.done || it.removed || it.habit || it.cycle.is_some() {
                continue;
            }
            let until = if let Some(a) = &it.after {
                let finished = self.index.get(a).is_some_and(|&j| self.items[j].done);
                if finished {
                    None
                } else {
                    Some(now + self.p.dep_recheck)
                }
            } else {
                None
            };
            let until = until.or_else(|| {
                let w = window_end?;
                (it.block > 0.0 && w - now < it.block.min(self.reff(k).max(0.0)) - EPS).then_some(w)
            });
            if let Some(u) = until {
                let id = it.id.clone();
                let old = self.holds.get(&id).copied().unwrap_or(f64::NEG_INFINITY);
                if u > old {
                    self.holds.insert(id.clone(), u);
                    self.fresh_holds.push((id, now, u));
                }
            }
        }
    }

    pub fn complete(&mut self, id: &str, _now: f64) {
        if let Some(&k) = self.index.get(id) {
            self.items[k].done = true;
        }
    }

    pub fn reopen(&mut self, id: &str, now: f64) {
        self.roll(now);
        if let Some(&k) = self.index.get(id) {
            self.items[k].done = false;
        }
    }

    pub fn remove(&mut self, id: &str, _now: f64) {
        if let Some(&k) = self.index.get(id) {
            self.items[k].removed = true;
        }
    }

    /// Closes repeating windows up to `now` (what `decide` does first).
    pub fn advance(&mut self, now: f64) {
        self.roll(now);
    }

    pub fn log(&mut self, start: f64, dur: f64, kind: LogKind, target: &str) {
        let day = fdiv(start);
        if kind == LogKind::Adjust {
            // A correction moves only the item's own work; the day's directed time stays as it was.
            if let Some(&k) = self.index.get(target) {
                self.ilogs[k].push((start, dur));
            }
            return;
        }
        if self.first_day.is_none() {
            self.first_day = Some(day);
        }
        *self.day_total.entry(day).or_insert(0.0) += dur;
        match kind {
            LogKind::Work | LogKind::Extra => {
                if let Some(&k) = self.index.get(target) {
                    self.ilogs[k].push((start, dur));
                    if kind == LogKind::Extra {
                        *self.extra_logs.entry((day, k)).or_insert(0.0) += dur;
                    }
                }
                self.last_work = Some((day, target.into()));
            }
            LogKind::Adjust => unreachable!(),
            LogKind::Reward | LogKind::Rest | LogKind::Wait => {
                *self.dlogs.entry((day, target.into())).or_insert(0.0) += dur;
            }
        }
    }

    // ------------------------------------------------------------------ derived quantities

    fn window_start(&self, it: &Item) -> f64 {
        if let Some(c) = it.cycle {
            let ws = it.d - c;
            return it.start.map_or(ws, |s| ws.max(s));
        }
        it.start.unwrap_or(it.created)
    }

    /// Work logged inside the current window (one-off: all work on the item).
    fn w_of(&self, k: usize) -> f64 {
        let it = &self.items[k];
        let lo = it.cycle.map_or(f64::NEG_INFINITY, |c| it.d - c);
        self.ilogs[k].iter().filter(|(st, _)| *st >= lo - EPS).map(|(_, d)| d).sum()
    }

    fn l_of(&self, k: usize) -> f64 {
        let qt = self.items[k].q_time;
        self.ilogs[k].iter().filter(|(st, _)| *st >= qt - EPS).map(|(_, d)| d).sum()
    }

    /// Stated remaining: habit floor Q − W; otherwise Q − L.
    fn r_of(&self, k: usize) -> f64 {
        let it = &self.items[k];
        if it.habit {
            it.q - self.w_of(k)
        } else {
            it.q - self.l_of(k)
        }
    }

    fn pending(&self, k: usize) -> bool {
        let it = &self.items[k];
        if it.done || it.removed {
            return false;
        }
        if it.habit {
            self.r_of(k) > EPS
        } else {
            true
        }
    }

    /// Planning remaining: an unfinished non-habit item with R ≤ 0 is an overrun and plans one session.
    fn reff(&self, k: usize) -> f64 {
        let r = self.r_of(k);
        if self.items[k].habit {
            return r.max(0.0);
        }
        if r > EPS {
            r
        } else {
            self.p.s
        }
    }

    fn t_of(&self, k: usize) -> f64 {
        self.w_of(k) + self.reff(k)
    }

    fn key(&self, k: usize) -> Key {
        (self.items[k].id.clone(), self.items[k].cycle_no)
    }

    fn entry(&mut self, k: usize) -> Entry {
        let key = self.key(k);
        if let Some(e) = self.ledger.get(&key) {
            return *e;
        }
        let it = &self.items[k];
        let r = self.window_start(it);
        let ta = if it.cycle.is_none() { r.max(it.created) } else { r };
        let e = Entry { ta, ea: 0.0, r, d: it.d };
        self.ledger.insert(key, e);
        e
    }

    /// Cumulative entitlement at t (§3). A pure function of the row, T and t.
    fn ent(&self, e: Entry, t_total: f64, t: f64) -> f64 {
        let end = e.r + self.p.pace * (e.d - e.r);
        if end <= e.ta + EPS {
            return t_total;
        }
        let x = e.ea + (t_total - e.ea) * ((t - e.ta) / (end - e.ta)).clamp(0.0, 1.0);
        x.min(t_total)
    }

    /// Re-anchors so entitlement is continuous at `now`, then applies the change (§3).
    fn change(&mut self, k: usize, now: f64, mutate: impl FnOnce(&mut Item)) {
        if self.items[k].done || !self.pending(k) {
            mutate(&mut self.items[k]);
            return;
        }
        let e = self.entry(k);
        let e_old = self.ent(e, self.t_of(k), now);
        mutate(&mut self.items[k]);
        let r_new = self.window_start(&self.items[k]);
        let t_new = self.t_of(k);
        let key = self.key(k);
        self.ledger.insert(key, Entry { ta: now.max(r_new), ea: e_old.min(t_new), r: r_new, d: self.items[k].d });
    }

    /// Closes every repeating window whose deadline has passed (§4).
    fn roll(&mut self, now: f64) {
        for k in 0..self.items.len() {
            let Some(c) = self.items[k].cycle else { continue };
            if self.items[k].removed {
                continue;
            }
            while now >= self.items[k].d - EPS {
                let it = &self.items[k];
                let unmet = !it.done && if it.habit { self.r_of(k) > EPS } else { true };
                if unmet {
                    self.missed.push(Missed { id: it.id.clone(), d: it.d, habit_floor: it.habit });
                }
                let it = &mut self.items[k];
                it.d += c;
                if self.p.shift_start {
                    it.start = it.start.map(|s| s + c);
                }
                it.cycle_no += 1;
                it.done = false;
                it.q_time = it.d - c;
                if !it.habit {
                    it.q = it.qc.unwrap_or(it.q);
                }
            }
        }
    }

    /// Daily directed hours: weighted mean and sd of completed days, shrunk toward the prior (§5.1).
    pub fn forecast(&self, now: f64) -> (f64, f64) {
        if let Some(f) = self.forecast_override {
            return f;
        }
        let p = &self.p;
        let today = fdiv(now);
        let lam = 0.5f64.powf(1.0 / p.half_life);
        let xs: Vec<f64> = match self.first_day {
            None => vec![],
            Some(f) => match p.empty_days {
                EmptyDays::Zero => (f..today).map(|d| *self.day_total.get(&d).unwrap_or(&0.0)).collect(),
                EmptyDays::Skip => (f..today).filter_map(|d| self.day_total.get(&d).copied().filter(|x| *x > EPS)).collect(),
            },
        };
        let n = xs.len();
        let wp = p.w0 * lam.powi(n as i32);
        let ws: Vec<f64> = (0..n).map(|i| lam.powi((n - 1 - i) as i32)).collect();
        let wt = wp + ws.iter().sum::<f64>();
        let mean = (wp * p.m0 + ws.iter().zip(&xs).map(|(w, x)| w * x).sum::<f64>()) / wt;
        let var = (wp * p.sd0 * p.sd0 + ws.iter().zip(&xs).map(|(w, x)| w * (x - mean) * (x - mean)).sum::<f64>()) / wt;
        (mean, var.sqrt())
    }

    /// Expected rest of today's directed time given what is logged today (§5.2).
    pub fn today_remaining(&self, now: f64) -> f64 {
        let (f, sd) = self.forecast(now);
        let used = *self.day_total.get(&fdiv(now)).unwrap_or(&0.0);
        let mid = DAY * ((now / DAY).floor() + 1.0);
        let rem = if sd <= EPS || self.p.today_rule == TodayRule::Naive {
            (f - used).max(0.0)
        } else {
            let a = (used - f) / sd;
            let tail = 0.5 * libm::erfc(a / std::f64::consts::SQRT_2);
            let pdf = (-0.5 * a * a).exp() / (2.0 * std::f64::consts::PI).sqrt();
            if tail > 1e-12 {
                f - used + sd * pdf / tail
            } else {
                sd / a.max(1.0)
            }
        };
        rem.max(0.0).min(mid - now)
    }

    fn desired_total(&self) -> f64 {
        self.rewards.iter().map(|(_, v)| v).sum::<f64>() + self.rest
    }

    /// Current instance of every pending item, plus future cycles inside the horizon (§4).
    fn instances(&self, now: f64) -> (Vec<Inst>, f64, f64) {
        let mid = DAY * ((now / DAY).floor() + 1.0);
        let he = DAY * (now / DAY).floor() + self.p.horizon_days as f64 * DAY;
        let mut out = vec![];
        let mut rate = 0.0;
        for (k, it) in self.items.iter().enumerate() {
            if self.pending(k) {
                let mut r = self.window_start(it);
                // Module 2: a held item is released no earlier than its hold (§5).
                if let Some(&u) = self.holds.get(&it.id) {
                    if u > now + EPS {
                        r = r.max(u);
                    }
                }
                let d = if it.d > now { it.d } else { mid };
                out.push(Inst { item: k, r, d, r_eff: self.reff(k), w: self.w_of(k), current: true });
            }
            if let (Some(c), false) = (it.cycle, it.removed) {
                let q = if it.habit { it.q } else { it.qc.unwrap_or(it.q) };
                let mut j = 1.0;
                while it.d + j * c <= he + EPS {
                    let ws = it.d + (j - 1.0) * c;
                    let shift = if self.p.shift_start { j * c } else { 0.0 };
                    let r = it.start.map_or(ws, |s| ws.max(s + shift));
                    out.push(Inst { item: k, r, d: it.d + j * c, r_eff: q, w: 0.0, current: false });
                    j += 1.0;
                }
                rate += q / (c / DAY);
            }
        }
        (out, rate, he)
    }

    // ------------------------------------------------------------------ feasibility

    /// Release-aware demand-bound slack (§6). `plain` drops the margin and the reserve.
    ///
    /// A day whose capacity is below one minimum session cannot hold a session that might run to s, so it
    /// counts as zero, except for habit-floor remainders that fit in it and whose window is that day: their
    /// length is known exactly, so they are served from it (§5.3).
    fn slack(&self, now: f64, insts: &[Inst], rate: f64, he: f64, plain: bool) -> Slack {
        let s = self.p.s;
        let (f, sd) = self.forecast(now);
        let reserve = if plain { 0.0 } else { self.desired_total() };
        let k_a = if plain { 0.0 } else { self.p.k_a };
        if insts.is_empty() {
            return Slack { b: vec![], now: vec![], fut_min: f64::INFINITY, fut_arg: None };
        }
        let r: Vec<f64> = insts.iter().map(|i| i.r.max(now)).collect();
        let dd: Vec<f64> = insts.iter().map(|i| i.d).collect();
        let mut rr: Vec<f64> = insts.iter().map(|i| i.r_eff).collect();
        let last = dd.iter().copied().fold(f64::NEG_INFINITY, f64::max);

        // Raw daily capacity: index 0 is the rest of today, then whole days.
        let mid = DAY * ((now / DAY).floor() + 1.0);
        let kk = 1i64.max(((last - mid) / DAY).ceil() as i64 + 1) as usize;
        let mut caps: Vec<f64> = (0..kk)
            .map(|j| {
                let st = mid + DAY * j as f64;
                (f - reserve - if st >= he - EPS { rate } else { 0.0 }).max(0.0)
            })
            .collect();
        let mut c0 = self.today_remaining(now);
        let days: Vec<(f64, f64, f64)> = std::iter::once((now, mid, c0))
            .chain((0..kk).map(|j| (mid + DAY * j as f64, mid + DAY * (j + 1) as f64, caps[j])))
            .collect();
        for (k, &(lo, hi, c)) in days.iter().enumerate() {
            let mut c = c;
            if EPS < c && c < s - EPS {
                for n in 0..insts.len() {
                    if self.items[insts[n].item].habit && r[n] >= lo - EPS && dd[n] <= hi + EPS && EPS < rr[n] && rr[n] <= c + EPS {
                        c -= rr[n];
                        rr[n] = 0.0;
                    }
                }
            }
            if k == 0 {
                if c0 < s - EPS {
                    c0 = 0.0;
                }
            } else if caps[k - 1] < s - EPS {
                caps[k - 1] = 0.0;
            }
        }
        let mut cum = vec![0.0; kk + 1];
        for j in 0..kk {
            cum[j + 1] = cum[j] + caps[j];
        }
        // Cumulative capacity C(t) from now; within a day, capacity accrues from its start (today: now).
        let cap = |t: f64| {
            let today = c0.min((t.min(mid) - now).max(0.0));
            let j = (((t - mid) / DAY).floor() as i64).clamp(0, kk as i64 - 1) as usize;
            let after = if t > mid { cum[j] + caps[j].min((t - (mid + DAY * j as f64)).max(0.0)) } else { 0.0 };
            today + after
        };

        let b = unique(dd.clone());
        let mut order: Vec<usize> = (0..dd.len()).collect();
        order.sort_by(|&x, &y| dd[x].partial_cmp(&dd[y]).unwrap());
        let ds: Vec<f64> = order.iter().map(|&i| dd[i]).collect();
        let mut cum_r = vec![0.0];
        for &i in &order {
            cum_r.push(cum_r.last().unwrap() + rr[i]);
        }
        let margin = |a: f64, bb: f64| {
            let nd = ((bb - EPS) / DAY).floor() - (a / DAY).floor() + 1.0;
            k_a * sd * nd.max(1.0).sqrt()
        };
        let s_now: Vec<f64> = b.iter().map(|&bb| cap(bb) - cum_r[search_right(&ds, bb)] - margin(now, bb)).collect();

        let mut fut_min = f64::INFINITY;
        let mut fut_arg = None;
        let a_rows = unique(r.iter().copied().filter(|x| *x > now + EPS && *x < he).collect());
        for a in a_rows {
            let m: Vec<usize> = (0..r.len()).filter(|&i| r[i] >= a - EPS).collect();
            if m.is_empty() {
                continue;
            }
            let mut mo = m.clone();
            mo.sort_by(|&x, &y| dd[x].partial_cmp(&dd[y]).unwrap());
            let dm: Vec<f64> = mo.iter().map(|&i| dd[i]).collect();
            let mut cm = vec![0.0];
            for &i in &mo {
                cm.push(cm.last().unwrap() + rr[i]);
            }
            let cb: Vec<f64> = b.iter().copied().filter(|x| *x > a).collect();
            if cb.is_empty() {
                continue;
            }
            let ca = cap(a);
            let sl: Vec<f64> = cb.iter().map(|&bb| cap(bb) - ca - cm[search_right(&dm, bb)] - margin(a, bb)).collect();
            let k = argmin(&sl);
            if sl[k] < fut_min {
                fut_min = sl[k];
                fut_arg = Some((a, cb[k]));
            }
        }
        Slack { b, now: s_now, fut_min, fut_arg }
    }

    // ------------------------------------------------------------------ decision

    fn lag(&mut self, i: &Inst, now: f64) -> f64 {
        let e = self.entry(i.item);
        let eod = DAY * ((now / DAY).floor() + 1.0);
        self.ent(e, i.w + i.r_eff, eod) - i.w
    }

    fn id(&self, i: &Inst) -> &str {
        &self.items[i.item].id
    }

    /// Planned session length. A started task session commits to s unless the task is completed, and
    /// completion is uncertain, so the guard reserves s. A habit-floor remainder is known exactly.
    fn plen(&self, i: &Inst) -> f64 {
        if self.items[i.item].habit {
            self.p.s.min(i.r_eff)
        } else {
            self.p.s
        }
    }

    /// The earliest deadline row before `d` whose slack is under `ell`, if any: what `legal` rejects on.
    fn short_row(&self, rows: &Slack, d: f64, ell: f64) -> Option<f64> {
        rows.b.iter().zip(&rows.now).find(|(bb, v)| **bb < d - EPS && **v < ell - EPS).map(|(bb, _)| *bb)
    }

    /// The item due at row `b`, preferring a current window, for naming a blocked choice.
    fn owner_of(&self, insts: &[Inst], b: f64) -> Option<String> {
        let at: Vec<&Inst> = insts.iter().filter(|i| (i.d - b).abs() <= EPS).collect();
        at.iter().find(|i| i.current).or(at.first()).map(|i| self.items[i.item].id.clone())
    }

    /// The guard (§6): starting `i` keeps every earlier deadline's row at least its session length.
    fn legal(&self, i: &Inst, rows: &Slack) -> bool {
        let ell = self.plen(i);
        let before: Vec<f64> = rows.b.iter().zip(&rows.now).filter(|(bb, _)| **bb < i.d - EPS).map(|(_, v)| *v).collect();
        before.is_empty() || vmin(&before) >= ell - EPS
    }

    /// Decides at `now` with Module 2's window context: the end of the current availability window,
    /// when one is known. With no window plan only dependencies (and recorded holds) apply.
    pub fn decide_with(&mut self, now: f64, window_end: Option<f64>) -> Decision {
        self.module2(now, window_end);
        self.decide_at(now)
    }

    pub fn decide_at(&mut self, now: f64) -> Decision {
        let s = self.p.s;
        self.roll(now);
        let (insts, rate, he) = self.instances(now);
        let day = fdiv(now);
        let cur_id: Option<String> = self.last_work.as_ref().filter(|(d, _)| *d == day).map(|(_, id)| id.clone());
        let cur_cat: Option<String> = cur_id.as_ref().and_then(|id| self.index.get(id)).and_then(|&k| self.items[k].category.clone());

        // Alerts and prompts (§8). They never change the plan by themselves.
        let mut alerts = vec![];
        let mut prompts = vec![];
        let pl = self.slack(now, &insts, rate, he, true);
        if !pl.now.is_empty() && vmin(&pl.now) < -EPS {
            let j = argmin(&pl.now);
            alerts.push(Alert::Overload { from: now, to: pl.b[j], short: -pl.now[j] });
        }
        if pl.fut_min < -EPS {
            let (a, b) = pl.fut_arg.unwrap();
            alerts.push(Alert::Overload { from: a, to: b, short: -pl.fut_min });
        }
        for k in 0..self.items.len() {
            let it = &self.items[k];
            if it.removed {
                continue;
            }
            if !it.done && it.cycle.is_none() && it.d <= now {
                alerts.push(Alert::Overdue { id: it.id.clone() });
            }
            if !it.done && !it.habit && self.r_of(k) <= EPS {
                prompts.push(it.id.clone());
            }
        }

        let released: Vec<Inst> = insts.iter().filter(|i| i.current && i.r <= now + EPS).cloned().collect();
        let mk = |kind: DecisionKind, target: Option<String>, length: f64, rule: &str, mode: Mode, basis: Basis| Decision {
            kind,
            target,
            length,
            rule: rule.into(),
            mode,
            alerts: alerts.clone(),
            prompts: prompts.clone(),
            basis,
        };
        let work = |me: &Self, i: &Inst, rule: &str, mode: Mode, basis: Basis| mk(DecisionKind::Work, Some(me.id(i).to_string()), me.plen(i), rule, mode, basis);

        let disc = self.disc_choice(day, f64::INFINITY);
        let extra = self.extra_choice(now, cur_id.as_deref(), cur_cat.as_deref());
        let idle = |rule: &str| -> Decision {
            if let Some((kind, name, len)) = &disc {
                return mk(*kind, Some(name.clone()), *len, rule, Mode::Normal, Basis::Idle);
            }
            if let Some(h) = &extra {
                return mk(DecisionKind::Extra, Some(h.clone()), s, rule, Mode::Normal, Basis::Idle);
            }
            mk(DecisionKind::Free, None, 0.0, rule, Mode::Normal, Basis::Idle)
        };

        // Strict reference policy (not R1): work-conserving earliest deadline.
        if self.p.policy == Policy::Edf {
            if !released.is_empty() {
                let i = self.edf(&released, cur_id.as_deref(), now);
                return work(self, &i, "edf", Mode::Normal, Basis::None);
            }
            return idle("edf-idle");
        }

        // R1 (§7).
        if released.is_empty() {
            return idle("1-none-released");
        }

        // Protect step (rules 2 and 7): no released item can start a session without endangering an
        // earlier deadline in the rows in force. Prefer a released item that is safe under the plain check;
        // otherwise wait for the next known release if the wait itself fits in every row's slack;
        // otherwise earliest deadline.
        let protect = |me: &mut Self, rows: &Slack, rule: &str, mode: Mode, basis: Basis| -> Decision {
            let safe: Vec<Inst> = released.iter().filter(|i| me.legal(i, &pl)).cloned().collect();
            if !safe.is_empty() {
                // A habit tied with the earliest deadline can go first at no cost: among equal deadlines
                // the order does not change whether either is met.
                let dmin = vmin(&safe.iter().map(|i| i.d).collect::<Vec<_>>());
                let tied: Vec<Inst> = safe.iter().filter(|i| i.d <= dmin + EPS).cloned().collect();
                if let Some(i) = me.habit_pace(now, &tied, &pl) {
                    return work(me, &i, &format!("{rule}-habit-pooled"), mode, basis);
                }
                let i = me.edf(&safe, cur_id.as_deref(), now);
                return work(me, &i, rule, mode, basis);
            }
            let nxt = insts.iter().map(|i| i.r).filter(|r| *r > now + EPS).fold(f64::INFINITY, f64::min);
            let room = vmin(&rows.now).min(vmin(&pl.now));
            if nxt.is_finite() {
                let w = nxt - now;
                if w <= room + EPS {
                    let wrule = format!("{rule}-wait");
                    if let Some((kind, name, len)) = me.disc_choice(day, w) {
                        return mk(kind, Some(name), len, &wrule, mode, Basis::Protect);
                    }
                    return mk(DecisionKind::Wait, None, w, &wrule, mode, Basis::Protect);
                }
            }
            let i = me.edf(&released, cur_id.as_deref(), now);
            work(me, &i, rule, mode, basis)
        };

        let sl = self.slack(now, &insts, rate, he, false);
        if !sl.now.is_empty() && vmin(&sl.now) < -EPS {
            let short = !pl.now.is_empty() && vmin(&pl.now) < -EPS;
            return protect(self, &pl, "2-margin-edf", Mode::Margin, if short { Basis::Shortfall } else { Basis::Precaution });
        }

        let ok: Vec<Inst> = released.iter().filter(|i| self.legal(i, &sl)).cloned().collect();
        let lags: Vec<f64> = ok.iter().map(|i| self.lag(i, now)).collect();
        // 'deadline-pace' if even pacing to the real deadline would also ask for this today;
        // 'early-guide' if only the hidden earlier pace guide does.
        let due_basis = |i: &Inst| {
            let days_left = 1f64.max(((i.d - now) / DAY - EPS).ceil());
            if i.r_eff / days_left >= (s / 2.0).min(i.r_eff) - EPS {
                Basis::DeadlinePace
            } else {
                Basis::EarlyGuide
            }
        };
        if let Some(i) = self.habit_pace(now, &ok, &pl) {
            return work(self, &i, "3-habit-pooled", Mode::Normal, Basis::DeadlinePace);
        }
        let due: Vec<(Inst, f64)> = ok
            .iter()
            .zip(&lags)
            .filter(|(i, l)| **l >= (s / 2.0).min(i.r_eff) - EPS)
            .map(|(i, l)| (i.clone(), *l))
            .collect();
        if !due.is_empty() {
            if let Some((i, _)) = due.iter().find(|(i, _)| Some(self.id(i)) == cur_id.as_deref()) {
                return work(self, i, "3-due-continue", Mode::Normal, due_basis(i));
            }
            let pool = self.same_category(due, cur_cat.as_deref());
            let (i, _) = pool
                .iter()
                .min_by(|(x, lx), (y, ly)| cmp3((x.d, -lx, self.id(x)), (y.d, -ly, self.id(y))))
                .unwrap();
            return work(self, i, "3-due", Mode::Normal, due_basis(i));
        }

        let gmin = if sl.now.is_empty() { f64::INFINITY } else { vmin(&sl.now) };
        let pmin = if pl.now.is_empty() { f64::INFINITY } else { vmin(&pl.now) };
        if self.p.habit_extra_once && matches!(&disc, Some((DecisionKind::Reward, _, _))) {
            // Rest keeps its time; then one extra session per habit; rewards after that.
            let rl = self.rest - self.dlogs.get(&(day, "rest".to_string())).copied().unwrap_or(0.0);
            if rl > EPS && gmin >= rl.min(s) - EPS {
                return mk(DecisionKind::Rest, Some("rest".into()), rl.min(s), "4-rest-first", Mode::Normal, Basis::Idle);
            }
            if let Some(h) = &extra {
                let k = self.index[h];
                let ex = self.extra_logs.get(&(day, k)).copied().unwrap_or(0.0);
                if ex < s - EPS && gmin >= s - EPS {
                    return mk(DecisionKind::Extra, Some(h.clone()), s, "5-habit-extra-first", Mode::Normal, Basis::Idle);
                }
            }
        }
        if let Some((kind, name, len)) = &disc {
            if gmin >= len - EPS {
                return mk(*kind, Some(name.clone()), *len, "4-discretionary", Mode::Normal, Basis::Idle);
            }
        }
        // Is free time withheld only by the margin?
        let held = match &disc {
            Some((_, _, len)) if pmin >= len - EPS => Basis::Precaution,
            _ => Basis::Ahead,
        };
        if let Some(h) = &extra {
            if gmin >= s - EPS {
                return mk(DecisionKind::Extra, Some(h.clone()), s, "5-habit-extra", Mode::Normal, Basis::Idle);
            }
        }
        if !ok.is_empty() {
            let pool: Vec<(Inst, f64)> = ok.iter().cloned().zip(lags.iter().copied()).collect();
            if let Some((i, _)) = pool.iter().find(|(i, _)| Some(self.id(i)) == cur_id.as_deref()) {
                return work(self, i, "6-ahead-continue", Mode::Normal, held);
            }
            let pool = self.same_category(pool, cur_cat.as_deref());
            let (i, _) = pool
                .iter()
                .max_by(|(x, lx), (y, ly)| cmp3((*lx, -x.d, self.id(x)), (*ly, -y.d, self.id(y))))
                .unwrap();
            return work(self, i, "6-ahead", Mode::Normal, held);
        }
        protect(self, &sl, "7-guard", Mode::Normal, Basis::Protect)
    }

    /// What the interface shows about each item and the forecast. Reading it never changes a decision:
    /// it only creates ledger rows exactly as `decide` would.
    ///
    /// `start_now` says what you could start yourself instead of the decision. It uses the plain check
    /// against the real deadlines, without the availability margin (the margin is Lot's own caution, and
    /// spending it is the user's call): an item may start if it's released, still owes work, and one
    /// session of it leaves every earlier deadline at least that much slack, as in the guard. A habit's
    /// session is what's left of its minimum, at most one minimum session; a task's is one minimum session.
    pub fn view(&mut self, now: f64) -> View {
        self.roll(now);
        let day = fdiv(now);
        let (f, sd) = self.forecast(now);
        let (insts, rate, he) = self.instances(now);
        let pl = self.slack(now, &insts, rate, he, true);
        let mut items = vec![];
        for k in 0..self.items.len() {
            if self.items[k].removed {
                continue;
            }
            let it = self.items[k].clone();
            let pending = self.pending(k);
            let r = self.window_start(&it);
            let w = self.w_of(k);
            let stated = self.r_of(k);
            let r_eff = self.reff(k);
            let lag = if pending {
                let i = Inst { item: k, r, d: it.d, r_eff, w, current: true };
                self.lag(&i, now).max(0.0)
            } else {
                0.0
            };
            let days_left = 1f64.max(((it.d - now) / DAY - EPS).ceil());
            items.push(ItemView {
                id: it.id.clone(),
                window_start: r,
                start: it.start,
                held_until: self.holds.get(&it.id).copied().filter(|u| *u > now + EPS),
                deadline: it.d,
                released: r <= now + EPS,
                pending,
                done: it.done,
                habit: it.habit,
                cycle: it.cycle,
                category: it.category.clone(),
                worked: w,
                remaining: stated,
                planning_remaining: r_eff,
                suggested_today: lag,
                even_pace_per_day: if pending && it.d > now { r_eff / days_left } else { 0.0 },
                overdue: it.cycle.is_none() && !it.done && it.d <= now,
                used_up: !it.done && !it.habit && stated <= EPS,
                start_now: None,
                blocked_by: None,
            });
            if let Some(i) = insts.iter().find(|i| i.current && i.item == k && i.r <= now + EPS) {
                let ell = self.plen(i);
                let v = items.last_mut().unwrap();
                match self.short_row(&pl, i.d, ell) {
                    None => v.start_now = Some(ell),
                    Some(b) => v.blocked_by = self.owner_of(&insts, b),
                }
            }
        }
        let disc = self
            .rewards
            .iter()
            .cloned()
            .chain(std::iter::once(("rest".to_string(), self.rest)))
            .map(|(name, want)| {
                let taken = self.dlogs.get(&(day, name.clone())).copied().unwrap_or(0.0);
                let left = (want - taken).min(self.p.s);
                let short = if left > EPS { self.short_row(&pl, f64::INFINITY, left) } else { None };
                let start_now = (left > EPS && short.is_none()).then_some(left);
                DiscView { name, desired: want, taken, start_now, blocked_by: short.and_then(|b| self.owner_of(&insts, b)) }
            })
            .collect();
        View {
            forecast_mean: f,
            forecast_sd: sd,
            logged_today: *self.day_total.get(&day).unwrap_or(&0.0),
            today_remaining: self.today_remaining(now),
            items,
            disc,
        }
    }

    /// Pooled habit pacing (`habit_pacing`): among `ok`, the daily habit with the most left, if today's
    /// habit minimums as one pool are at least half its block behind an even share of today's expected
    /// directed time. Only habits due by tonight, and only where every row up to tonight still fits
    /// under the plain forecast `pl`, so moving a habit ahead never decides which deadline misses.
    fn habit_pace(&mut self, now: f64, ok: &[Inst], pl: &Slack) -> Option<Inst> {
        if !self.p.habit_pacing || self.p.policy != Policy::R1 {
            return None;
        }
        let eod = DAY * ((now / DAY).floor() + 1.0);
        let hab: Vec<&Inst> = ok
            .iter()
            .filter(|i| self.items[i.item].habit && i.r_eff > EPS && i.d <= eod + EPS)
            .filter(|i| {
                let rows: Vec<f64> = pl.b.iter().zip(&pl.now).filter(|(b, _)| **b <= i.d + EPS).map(|(_, v)| *v).collect();
                rows.is_empty() || vmin(&rows) >= -EPS
            })
            .collect();
        let pick = (*hab.iter().max_by(|x, y| cmp3((x.r_eff, 0.0, self.id(x)), (y.r_eff, 0.0, self.id(y))))?).clone();
        let day = fdiv(now);
        let used = *self.day_total.get(&day).unwrap_or(&0.0);
        let expd = (used + self.today_remaining(now)).max(self.p.s);
        let (mut tot, mut wdone) = (0.0, 0.0);
        for k in 0..self.items.len() {
            let it = &self.items[k];
            if it.habit && !it.done && !it.removed && it.cycle.is_some_and(|c| c <= DAY + EPS) {
                tot += it.q;
                wdone += self.w_of(k).min(it.q);
            }
        }
        let ell = self.plen(&pick);
        let lag = tot * ((used + ell / 2.0) / expd).min(1.0) - wdone;
        (lag >= ell / 2.0 - EPS).then_some(pick)
    }

    fn same_category(&self, pool: Vec<(Inst, f64)>, cat: Option<&str>) -> Vec<(Inst, f64)> {
        if let Some(c) = cat {
            let same: Vec<_> = pool.iter().filter(|(i, _)| self.items[i.item].category.as_deref() == Some(c)).cloned().collect();
            if !same.is_empty() {
                return same;
            }
        }
        pool
    }

    /// Earliest deadline; the current item wins a tie on the earliest deadline.
    fn edf(&mut self, c: &[Inst], cur_id: Option<&str>, now: f64) -> Inst {
        let dmin = vmin(&c.iter().map(|i| i.d).collect::<Vec<_>>());
        if let Some(i) = c.iter().find(|i| Some(self.id(i)) == cur_id && i.d <= dmin + EPS) {
            return i.clone();
        }
        let lags: Vec<f64> = c.iter().map(|i| self.lag(i, now)).collect();
        let k = (0..c.len())
            .min_by(|&x, &y| cmp3((c[x].d, -lags[x], self.id(&c[x])), (c[y].d, -lags[y], self.id(&c[y]))))
            .unwrap();
        c[k].clone()
    }

    /// The reward or rest with the largest share of today's desired time left, in a block of
    /// min(left, s, cap).
    fn disc_choice(&self, day: i64, cap: f64) -> Option<(DecisionKind, String, f64)> {
        let mut best: Option<((f64, String), String, f64)> = None;
        let all = self.rewards.iter().cloned().chain(std::iter::once(("rest".to_string(), self.rest)));
        for (name, want) in all {
            if want <= EPS {
                continue;
            }
            let left = want - self.dlogs.get(&(day, name.clone())).copied().unwrap_or(0.0);
            if left > EPS {
                let key = (left / want, name.clone());
                let better = match &best {
                    None => true,
                    Some((bk, _, _)) => key.0 > bk.0 || (key.0 == bk.0 && key.1 > bk.1),
                };
                if better {
                    best = Some((key, name, left));
                }
            }
        }
        let (_, name, left) = best?;
        let kind = if name == "rest" { DecisionKind::Rest } else { DecisionKind::Reward };
        Some((kind, name, left.min(self.p.s).min(cap)))
    }

    /// A habit whose floor is met: the current one, else the same category, else the least logged-to-floor.
    fn extra_choice(&self, now: f64, cur_id: Option<&str>, cur_cat: Option<&str>) -> Option<String> {
        let mut hs: Vec<usize> = (0..self.items.len())
            .filter(|&k| {
                let it = &self.items[k];
                it.habit && !it.done && !it.removed && !self.pending(k) && self.window_start(it) <= now + EPS
            })
            .collect();
        if hs.is_empty() {
            return None;
        }
        if let Some(&k) = hs.iter().find(|&&k| Some(self.items[k].id.as_str()) == cur_id) {
            return Some(self.items[k].id.clone());
        }
        if let Some(c) = cur_cat {
            let same: Vec<usize> = hs.iter().copied().filter(|&k| self.items[k].category.as_deref() == Some(c)).collect();
            if !same.is_empty() {
                hs = same;
            }
        }
        let k = hs
            .into_iter()
            .min_by(|&x, &y| {
                let rx = self.w_of(x) / self.items[x].q.max(EPS);
                let ry = self.w_of(y) / self.items[y].q.max(EPS);
                rx.partial_cmp(&ry).unwrap().then(self.items[x].id.cmp(&self.items[y].id))
            })
            .unwrap();
        Some(self.items[k].id.clone())
    }
}

impl Model for R1 {
    fn name(&self) -> &'static str {
        match self.p.policy {
            Policy::R1 => "r1",
            Policy::Edf => "edf",
        }
    }

    fn apply(&mut self, e: &Event) {
        match e {
            Event::Add { id, now, q, d, start, cycle, habit, category } => self.add_item(id, *now, *q, *d, *start, *cycle, *habit, category.clone()),
            Event::Estimate { id, now, q } => self.estimate(id, *now, *q),
            Event::Deadline { id, now, d } => self.set_deadline(id, *now, *d),
            Event::Start { id, now, start } => self.set_start(id, *now, *start),
            Event::Complete { id, now } => self.complete(id, *now),
            Event::Reopen { id, now } => self.reopen(id, *now),
            Event::Remove { id, now } => self.remove(id, *now),
            Event::Log { start, dur, kind, target } => self.log(*start, *dur, *kind, target),
            Event::Block { id, block, .. } => self.set_block(id, *block),
            Event::After { id, after, .. } => self.set_after(id, after.clone()),
            Event::Hold { id, until, .. } => self.hold(id, *until),
        }
    }

    fn decide(&mut self, now: Hours) -> Decision {
        self.decide_with(now, None)
    }

    fn missed(&self) -> &[Missed] {
        &self.missed
    }
}
