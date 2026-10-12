//! The model host: turns Lot's tasks and logged time into input events for the
//! next-task model (R1, or strict deadline order), keeps those events, and asks
//! the model what to do next.
//!
//! The model is the final one, R1new + Module 2: R1 plus a task's optional
//! minimum block and predecessor. Lot has no availability-window plan, so the
//! block check has no window end to test against and only predecessors (and
//! holds) apply, as the model description specifies for that case.
//!
//! The model sees only the observable inputs: per task the remaining estimate,
//! the deadline, an optional start, an optional repeat cycle, the habit label,
//! a category, and Module 2's block and predecessor; rewards and rest as desired daily durations; the minimum session;
//! and the log of what was done. Titles and notes never reach it.
//!
//! Events are stored with real instants, not model hours, so a change of time
//! zone or day rollover only needs a replay.

use std::collections::HashMap;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use chrono_tz::Tz;
use lot_model::{Decision, Discretionary, Event, LogKind, Model, ModelClock};
use lot_r1::{ItemView, Params, View, R1};
use serde::{Deserialize, Serialize};

/// Differences under a minute are rounding, not changes.
const TOL_H: f64 = 1.0 / 60.0;

/// One model input, as stored in `model_events`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "ev", rename_all = "snake_case")]
pub enum Stored {
    Add {
        id: String,
        at: DateTime<Utc>,
        /// Task: remaining estimate. Habit: minimum per cycle.
        q_min: f64,
        due: DateTime<Utc>,
        #[serde(default)]
        start: Option<DateTime<Utc>>,
        #[serde(default)]
        cycle_min: Option<f64>,
        #[serde(default)]
        habit: bool,
        #[serde(default)]
        category: Option<String>,
    },
    Estimate { id: String, at: DateTime<Utc>, q_min: f64 },
    Deadline { id: String, at: DateTime<Utc>, due: DateTime<Utc> },
    Start { id: String, at: DateTime<Utc>, start: Option<DateTime<Utc>> },
    Complete { id: String, at: DateTime<Utc> },
    Reopen { id: String, at: DateTime<Utc> },
    Remove { id: String, at: DateTime<Utc> },
    Log { start: DateTime<Utc>, dur_s: i64, kind: LogKind, target: String },
    /// Module 2: minimum contiguous block (0 = none).
    Block { id: String, at: DateTime<Utc>, block_min: f64 },
    /// Module 2: a task that must be finished first.
    After { id: String, at: DateTime<Utc>, after: Option<String> },
    /// Module 2: unavailable until `until` (set by the model's pre-step).
    Hold { id: String, at: DateTime<Utc>, until: DateTime<Utc> },
}

/// What Lot knows about one task, in the model's terms.
#[derive(Clone, Debug, PartialEq)]
pub struct Facts {
    pub id: String,
    /// Task: Q, the estimate since the last re-estimate. Habit: the minimum per cycle.
    pub q_min: f64,
    /// Task: L, logged since the last estimate. Habit: logged in the current cycle.
    pub l_min: f64,
    /// The real deadline (for a repeating item, the current occurrence's).
    pub due: DateTime<Utc>,
    pub start: Option<DateTime<Utc>>,
    pub cycle_min: Option<f64>,
    pub habit: bool,
    pub category: Option<String>,
    /// Module 2: minimum contiguous block, minutes (0 = none). One-off tasks only.
    pub block_min: f64,
    /// Module 2: an open task that must be finished first. One-off tasks only.
    pub after: Option<String>,
}

/// What the model was last told about an item's fixed fields.
#[derive(Clone, Debug, PartialEq)]
struct Fed {
    start: Option<DateTime<Utc>>,
    cycle_min: Option<f64>,
    habit: bool,
    category: Option<String>,
    /// A habit's minimum as last fed.
    floor_min: f64,
    removed: bool,
    block_min: f64,
    after: Option<String>,
}

/// Everything that shapes the model besides its events.
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub params: Params,
    pub disc: Discretionary,
    pub tz: Tz,
    pub rollover_hour: u32,
}

pub struct ModelHost {
    cfg: Config,
    clock: ModelClock,
    model: R1,
    events: Vec<Stored>,
    fed: HashMap<String, Fed>,
    /// Emitted since the last `take_new`, for the store.
    fresh: Vec<Stored>,
    /// Inputs changed since the last decision.
    pub changed: bool,
}

fn epoch() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 1, 1).unwrap()
}

impl ModelHost {
    pub fn new(cfg: Config, events: Vec<Stored>) -> Self {
        let clock = ModelClock::new(cfg.tz, cfg.rollover_hour, epoch());
        let model = R1::new(cfg.params.clone(), &cfg.disc);
        let mut h = Self { cfg, clock, model, events: Vec::new(), fed: HashMap::new(), fresh: Vec::new(), changed: true };
        for e in events {
            h.apply(&e);
            h.events.push(e);
        }
        h
    }

    pub fn config(&self) -> &Config {
        &self.cfg
    }

    /// Rebuilds the model from its events under a new configuration.
    pub fn reconfigure(&mut self, cfg: Config) {
        if cfg != self.cfg {
            let events = std::mem::take(&mut self.events);
            let fresh = std::mem::take(&mut self.fresh);
            *self = Self::new(cfg, events);
            self.fresh = fresh;
        }
    }

    pub fn name(&self) -> &'static str {
        self.model.name()
    }

    /// Model hours for an instant.
    pub fn hours(&self, t: DateTime<Utc>) -> f64 {
        self.clock.hours(&t.with_timezone(&self.cfg.tz))
    }

    /// The instant for model hours.
    pub fn instant(&self, h: f64) -> DateTime<Utc> {
        self.clock.instant(h).with_timezone(&Utc)
    }

    /// Events emitted since the last call, to persist.
    pub fn take_new(&mut self) -> Vec<Stored> {
        std::mem::take(&mut self.fresh)
    }

    fn apply(&mut self, e: &Stored) {
        let ev = match e {
            Stored::Add { id, at, q_min, due, start, cycle_min, habit, category } => {
                self.fed.insert(
                    id.clone(),
                    Fed {
                        start: *start,
                        cycle_min: *cycle_min,
                        habit: *habit,
                        category: category.clone(),
                        floor_min: *q_min,
                        removed: false,
                        // The model keeps Module 2 inputs across a re-add.
                        block_min: self.fed.get(id).map_or(0.0, |f| f.block_min),
                        after: self.fed.get(id).and_then(|f| f.after.clone()),
                    },
                );
                Event::Add {
                    id: id.clone(),
                    now: self.hours(*at),
                    q: q_min / 60.0,
                    d: self.hours(*due),
                    start: start.map(|s| self.hours(s)),
                    cycle: cycle_min.map(|c| c / 60.0),
                    habit: *habit,
                    category: category.clone(),
                }
            }
            Stored::Estimate { id, at, q_min } => {
                if let Some(f) = self.fed.get_mut(id).filter(|f| f.habit) {
                    f.floor_min = *q_min;
                }
                Event::Estimate { id: id.clone(), now: self.hours(*at), q: q_min / 60.0 }
            }
            Stored::Deadline { id, at, due } => Event::Deadline { id: id.clone(), now: self.hours(*at), d: self.hours(*due) },
            Stored::Start { id, at, start } => {
                if let Some(f) = self.fed.get_mut(id) {
                    f.start = *start;
                }
                Event::Start { id: id.clone(), now: self.hours(*at), start: start.map(|s| self.hours(s)) }
            }
            Stored::Complete { id, at } => Event::Complete { id: id.clone(), now: self.hours(*at) },
            Stored::Reopen { id, at } => Event::Reopen { id: id.clone(), now: self.hours(*at) },
            Stored::Remove { id, at } => {
                if let Some(f) = self.fed.get_mut(id) {
                    f.removed = true;
                }
                Event::Remove { id: id.clone(), now: self.hours(*at) }
            }
            Stored::Log { start, dur_s, kind, target } => {
                Event::Log { start: self.hours(*start), dur: *dur_s as f64 / 3600.0, kind: *kind, target: target.clone() }
            }
            Stored::Block { id, at, block_min } => {
                if let Some(f) = self.fed.get_mut(id) {
                    f.block_min = *block_min;
                }
                Event::Block { id: id.clone(), now: self.hours(*at), block: block_min / 60.0 }
            }
            Stored::After { id, at, after } => {
                if let Some(f) = self.fed.get_mut(id) {
                    f.after = after.clone();
                }
                Event::After { id: id.clone(), now: self.hours(*at), after: after.clone() }
            }
            Stored::Hold { id, at, until } => Event::Hold { id: id.clone(), now: self.hours(*at), until: self.hours(*until) },
        };
        self.model.apply(&ev);
    }

    fn emit(&mut self, e: Stored) {
        self.apply(&e);
        self.events.push(e.clone());
        self.fresh.push(e);
        self.changed = true;
    }

    /// Logs `dur_s` seconds ending at `end`.
    pub fn log(&mut self, end: DateTime<Utc>, dur_s: i64, kind: LogKind, target: &str) {
        if dur_s > 0 {
            self.emit(Stored::Log { start: end - Duration::seconds(dur_s), dur_s, kind, target: target.to_string() });
        }
    }

    /// Brings the model in line with Lot's tasks. `live` is the task in a running
    /// session, whose logged time reaches the model when the block is flushed.
    pub fn sync(&mut self, facts: &[Facts], live: Option<&str>, now: DateTime<Utc>) {
        let now_h = self.hours(now);
        self.model.advance(now_h);
        let view = self.model.view(now_h);
        let by_id: HashMap<&str, &ItemView> = view.items.iter().map(|i| (i.id.as_str(), i)).collect();
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for f in facts {
            seen.insert(f.id.clone());
            let fed = self.fed.get(&f.id).filter(|x| !x.removed);
            let reshaped = fed.map_or(true, |x| {
                x.habit != f.habit
                    || x.category != f.category
                    || match (x.cycle_min, f.cycle_min) {
                        (None, None) => false,
                        (Some(a), Some(b)) => (a - b).abs() > 1.0,
                        _ => true,
                    }
            });
            if reshaped || !by_id.contains_key(f.id.as_str()) {
                out.push(Stored::Add {
                    id: f.id.clone(),
                    at: now,
                    q_min: f.q_min,
                    due: f.due,
                    start: f.start,
                    cycle_min: f.cycle_min,
                    habit: f.habit,
                    category: f.category.clone(),
                });
                // Time already logged in this habit window counts toward its minimum.
                if f.habit && f.l_min >= 1.0 {
                    let dur_s = (f.l_min * 60.0).round() as i64;
                    let lo = f.cycle_min.map(|c| f.due - Duration::seconds((c * 60.0) as i64));
                    let start = lo.map_or(now - Duration::seconds(dur_s), |lo| lo.max(now - Duration::seconds(dur_s)));
                    out.push(Stored::Log { start, dur_s, kind: LogKind::Work, target: f.id.clone() });
                } else if !f.habit && f.l_min > 0.0 {
                    out.push(Stored::Estimate { id: f.id.clone(), at: now, q_min: f.q_min - f.l_min });
                }
                let (b, a) = fed.map_or((0.0, None), |x| (x.block_min, x.after.clone()));
                if (b - f.block_min).abs() > 0.5 {
                    out.push(Stored::Block { id: f.id.clone(), at: now, block_min: f.block_min });
                }
                if a != f.after {
                    out.push(Stored::After { id: f.id.clone(), at: now, after: f.after.clone() });
                }
                continue;
            }
            let fed = fed.unwrap().clone();
            let iv = by_id[f.id.as_str()];
            if (fed.block_min - f.block_min).abs() > 0.5 {
                out.push(Stored::Block { id: f.id.clone(), at: now, block_min: f.block_min });
            }
            if fed.after != f.after {
                out.push(Stored::After { id: f.id.clone(), at: now, after: f.after.clone() });
            }
            // Start dates. A repeating item's start moves with its deadline (s = z + n·c) inside the model
            // too, so compare in the model's current window: Lot's start, moved by the cycles the model is
            // ahead of Lot's occurrence.
            let ahead = match f.cycle_min {
                Some(c) => ((iv.deadline - self.hours(f.due)) / (c / 60.0)).round().max(0.0) * c,
                None => 0.0,
            };
            let want = f.start.map(|s| s + Duration::seconds((ahead * 60.0).round() as i64));
            let same_start = match (want, iv.start) {
                (None, None) => true,
                (Some(w), Some(h)) => (self.hours(w) - h).abs() <= TOL_H,
                _ => false,
            };
            if !same_start {
                out.push(Stored::Start { id: f.id.clone(), at: now, start: want });
            }
            // Deadlines. A repeating item's model window advances by itself at its deadline, and Lot
            // advances the Todoist occurrence when a cycle closes, so only a misaligned date is a change.
            let ld = self.hours(f.due);
            let mut same_window = true;
            match f.cycle_min {
                None => {
                    if (ld - iv.deadline).abs() > TOL_H {
                        out.push(Stored::Deadline { id: f.id.clone(), at: now, due: f.due });
                    }
                }
                Some(c) => {
                    let c = c / 60.0;
                    let diff = ld - iv.deadline;
                    let k = (diff / c).round();
                    if (diff - k * c).abs() > TOL_H || k < -1.0 {
                        out.push(Stored::Deadline { id: f.id.clone(), at: now, due: f.due });
                    } else if k >= 1.0 {
                        // Lot (or Todoist) closed this occurrence ahead of its deadline.
                        same_window = false;
                        if iv.pending {
                            out.push(Stored::Complete { id: f.id.clone(), at: now });
                        }
                    } else if k <= -1.0 {
                        // The model already rolled; Lot closes the occurrence on its next pass.
                        same_window = false;
                    } else if iv.done {
                        // Undone in Lot (or reopened in Todoist): this occurrence is open again.
                        out.push(Stored::Reopen { id: f.id.clone(), at: now });
                    }
                }
            }
            if !same_window || live == Some(f.id.as_str()) {
                continue;
            }
            if f.habit {
                if (fed.floor_min - f.q_min).abs() > 0.5 {
                    out.push(Stored::Estimate { id: f.id.clone(), at: now, q_min: f.q_min });
                }
                // Time typed into Todoist's logged field counts as work done; a lowered Logged value
                // takes work back out of this window, so the model's minimum matches Lot's.
                let more = f.l_min / 60.0 - iv.worked;
                if more > TOL_H && f.l_min < f.q_min {
                    out.push(Stored::Log { start: now - Duration::seconds((more * 3600.0) as i64), dur_s: (more * 3600.0).round() as i64, kind: LogKind::Work, target: f.id.clone() });
                } else if more < -TOL_H {
                    out.push(Stored::Log { start: now, dur_s: (more * 3600.0).round() as i64, kind: LogKind::Adjust, target: f.id.clone() });
                }
            } else {
                let lot_rem = (f.q_min - f.l_min) / 60.0;
                if (lot_rem - iv.remaining).abs() > TOL_H {
                    out.push(Stored::Estimate { id: f.id.clone(), at: now, q_min: f.q_min - f.l_min });
                }
            }
        }
        let gone: Vec<String> = self.fed.iter().filter(|(id, f)| !f.removed && !seen.contains(*id)).map(|(id, _)| id.clone()).collect();
        for id in gone {
            out.push(Stored::Remove { id, at: now });
        }
        for e in out {
            self.emit(e);
        }
    }

    /// Re-states a task's remaining work right away (a re-estimate during a session, which `sync`
    /// leaves alone while the session's time is still arriving).
    pub fn restate(&mut self, id: &str, at: DateTime<Utc>, remaining_min: f64) {
        if self.fed.get(id).is_some_and(|f| !f.removed && !f.habit) {
            self.emit(Stored::Estimate { id: id.to_string(), at, q_min: remaining_min });
        }
    }

    pub fn decide(&mut self, now: DateTime<Utc>) -> Decision {
        self.changed = false;
        let h = self.hours(now);
        let d = self.model.decide(h);
        // Module 2's holds are model state; keep them in the event log so a replay rebuilds them.
        for (id, at, until) in self.model.take_holds() {
            let e = Stored::Hold { id, at: self.instant(at), until: self.instant(until) };
            self.events.push(e.clone());
            self.fresh.push(e);
        }
        d
    }

    pub fn view(&mut self, now: DateTime<Utc>) -> View {
        let h = self.hours(now);
        self.model.view(h)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::America::New_York;
    use lot_model::DecisionKind;

    fn cfg() -> Config {
        Config { params: Params::default(), disc: Discretionary::default(), tz: New_York, rollover_hour: 4 }
    }

    fn t(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn task(id: &str, q: f64, l: f64, due: &str) -> Facts {
        Facts { id: id.into(), q_min: q, l_min: l, due: t(due), start: None, cycle_min: None, habit: false, category: None, block_min: 0.0, after: None }
    }

    #[test]
    fn adds_once_and_replays_to_the_same_state() {
        let now = t("2026-10-05T14:00:00Z");
        let mut h = ModelHost::new(cfg(), vec![]);
        let facts = vec![task("a", 300.0, 60.0, "2026-10-09T08:00:00Z")];
        h.sync(&facts, None, now);
        let first = h.take_new();
        assert_eq!(first.len(), 2, "add, then the remaining after L: {first:?}");
        h.sync(&facts, None, now + Duration::minutes(5));
        assert!(h.take_new().is_empty(), "nothing changed");
        let d = h.decide(now);
        assert_eq!(d.kind, DecisionKind::Work);
        assert_eq!(h.view(now).items[0].remaining, 4.0);

        let mut again = ModelHost::new(cfg(), first);
        assert_eq!(again.decide(now), d);
    }

    #[test]
    fn logged_session_time_is_not_a_re_estimate() {
        let now = t("2026-10-05T14:00:00Z");
        let mut h = ModelHost::new(cfg(), vec![]);
        h.sync(&[task("a", 300.0, 0.0, "2026-10-09T08:00:00Z")], None, now);
        h.log(now + Duration::minutes(60), 3600, LogKind::Work, "a");
        h.take_new();
        h.sync(&[task("a", 300.0, 60.0, "2026-10-09T08:00:00Z")], None, now + Duration::minutes(61));
        assert!(h.take_new().is_empty());
        // A re-estimate in Todoist is.
        h.sync(&[task("a", 120.0, 0.0, "2026-10-09T08:00:00Z")], None, now + Duration::minutes(62));
        assert!(matches!(h.take_new()[..], [Stored::Estimate { q_min, .. }] if q_min == 120.0));
    }

    #[test]
    fn repeating_close_completes_and_undo_reopens() {
        let now = t("2026-10-05T14:00:00Z");
        let mut f = task("r", 60.0, 0.0, "2026-10-06T21:00:00Z");
        f.cycle_min = Some(7.0 * 24.0 * 60.0);
        let mut h = ModelHost::new(cfg(), vec![]);
        h.sync(&[f.clone()], None, now);
        h.take_new();
        // Completed: Todoist moves the occurrence a week on.
        let mut next = f.clone();
        next.due = t("2026-10-13T21:00:00Z");
        h.sync(&[next], None, now);
        assert!(matches!(h.take_new()[..], [Stored::Complete { .. }]));
        // Undone within five seconds.
        h.sync(&[f.clone()], None, now);
        assert!(matches!(h.take_new()[..], [Stored::Reopen { .. }]));
        // A moved time of day is a new deadline.
        let mut moved = f.clone();
        moved.due = t("2026-10-06T23:00:00Z");
        h.sync(&[moved], None, now);
        assert!(matches!(h.take_new()[..], [Stored::Deadline { .. }]));
    }

    #[test]
    fn gone_tasks_are_removed() {
        let now = t("2026-10-05T14:00:00Z");
        let mut h = ModelHost::new(cfg(), vec![]);
        h.sync(&[task("a", 60.0, 0.0, "2026-10-09T08:00:00Z")], None, now);
        h.take_new();
        h.sync(&[], None, now);
        assert!(matches!(h.take_new()[..], [Stored::Remove { .. }]));
        assert_eq!(h.decide(now).kind, DecisionKind::Free);
    }
}
