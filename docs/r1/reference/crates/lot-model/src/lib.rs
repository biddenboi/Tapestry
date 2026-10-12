//! `lot-model`: the seam between Lot and whatever rule picks the next task.
//!
//! A model sees only the observable inputs of the problem spec, as an
//! append-only stream of [`Event`]s, and answers "what next" with a
//! [`Decision`]. Titles, descriptions, priorities and energy never cross this
//! boundary. Because the stream is the whole input, any model can be rebuilt
//! from Lot's stored log with [`replay`], and two models can be compared on the
//! same history.
//!
//! Time is in hours on one continuous clock where Lot day k is `[24k, 24k + 24)`.
//! [`ModelClock`] converts between that clock and real instants.

pub mod clock;

use serde::{Deserialize, Serialize};

pub use clock::ModelClock;

/// Hours on the model clock.
pub type Hours = f64;
pub type ItemId = String;

/// What a block of logged time was.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogKind {
    /// Work on a task, or on a habit up to its floor.
    Work,
    /// Habit time beyond its floor.
    Extra,
    Reward,
    Rest,
    /// Time spent waiting for a known release (counts toward the day's directed time).
    Wait,
    /// A correction to an item's logged work (negative when the user lowers it). It changes the
    /// item's work in its window only; the day's directed time and the forecast keep what happened.
    Adjust,
}

/// One observable input. The event log is the model's only source of truth.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "ev", rename_all = "snake_case")]
pub enum Event {
    /// An item appears. `q` is the remaining estimate (a habit's floor per cycle).
    Add {
        id: ItemId,
        now: Hours,
        q: Hours,
        d: Hours,
        #[serde(default)]
        start: Option<Hours>,
        /// Repetition cycle length.
        #[serde(default)]
        cycle: Option<Hours>,
        #[serde(default)]
        habit: bool,
        #[serde(default)]
        category: Option<String>,
    },
    /// The remaining estimate is re-stated. L counts from `now`.
    Estimate { id: ItemId, now: Hours, q: Hours },
    Deadline { id: ItemId, now: Hours, d: Hours },
    Start { id: ItemId, now: Hours, start: Option<Hours> },
    /// A one-off is finished, or a repeating item's current cycle is.
    Complete { id: ItemId, now: Hours },
    /// A completion was undone, or the cycle was reopened: the current window is pending again.
    Reopen { id: ItemId, now: Hours },
    /// The item left Lot (completed or deleted in Todoist, out of scope, or lost its details).
    /// Its log stays; it no longer takes part in any decision. A later `Add` brings it back.
    Remove { id: ItemId, now: Hours },
    /// Observed history: a block of time, and what it went to (an item id, or a reward name / "rest").
    Log { start: Hours, dur: Hours, kind: LogKind, #[serde(rename = "ref")] target: String },
    /// Module 2: the item needs one contiguous block of at least `block` hours (0 = none).
    Block { id: ItemId, now: Hours, block: Hours },
    /// Module 2: the item cannot start before `after` is finished (None = no predecessor).
    After { id: ItemId, now: Hours, after: Option<ItemId> },
    /// Module 2: the item is unavailable until `until` (a declined suggestion, or a hold the model set).
    Hold { id: ItemId, now: Hours, until: Hours },
}

impl Event {
    /// The time the event happened, for ordering.
    pub fn at(&self) -> Hours {
        match self {
            Event::Add { now, .. }
            | Event::Estimate { now, .. }
            | Event::Deadline { now, .. }
            | Event::Start { now, .. }
            | Event::Complete { now, .. }
            | Event::Reopen { now, .. }
            | Event::Remove { now, .. }
            | Event::Block { now, .. }
            | Event::After { now, .. }
            | Event::Hold { now, .. } => *now,
            Event::Log { start, dur, .. } => start + dur,
        }
    }
}

/// Discretionary settings: desired daily durations, in hours.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Discretionary {
    /// Reward name → desired hours per day. Ordered by name.
    pub rewards: std::collections::BTreeMap<String, Hours>,
    pub rest: Hours,
}

/// What to do next.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecisionKind {
    Work,
    /// Habit time beyond its floor.
    Extra,
    Reward,
    Rest,
    /// Nothing can usefully start until a known release; `length` is the wait.
    Wait,
    /// Nothing needs doing.
    Free,
}

/// Why a decision was made (R1-spec §7, basis labels). Shown to the person so
/// pressure that comes from the model's own caution never reads as a deadline.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Basis {
    /// Even pacing to the real deadline would ask for it today.
    DeadlinePace,
    /// Only the model's hidden early pace guide asks for it.
    EarlyGuide,
    /// Nothing is due and free time is met.
    Ahead,
    /// The availability margin alone is withholding free time or forcing deadline order.
    Precaution,
    /// The plain feasibility check fails.
    Shortfall,
    /// The guard redirected the choice to protect an earlier deadline.
    Protect,
    /// Free time, rest, reward or habit extra.
    Idle,
    /// No basis (the strict reference policy).
    #[default]
    #[serde(rename = "")]
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Normal,
    /// The availability margin is breached; the model is in strict deadline order.
    Margin,
}

/// Shown to the person. Alerts never change the plan by themselves.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "alert", rename_all = "snake_case")]
pub enum Alert {
    /// More work in `[from, to]` than forecast capacity, by `short` hours.
    Overload { from: Hours, to: Hours, short: Hours },
    /// A one-off is past its deadline and still open.
    Overdue { id: ItemId },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Decision {
    pub kind: DecisionKind,
    /// The item id (work, extra) or the reward name / "rest".
    #[serde(rename = "ref")]
    pub target: Option<String>,
    /// Planned length in hours. Work may end earlier only by completion.
    pub length: Hours,
    /// Which rule fired, for the decision log.
    pub rule: String,
    pub mode: Mode,
    pub alerts: Vec<Alert>,
    /// Items whose stated remaining is used up: ask for a re-estimate.
    pub prompts: Vec<ItemId>,
    #[serde(default)]
    pub basis: Basis,
}

impl Decision {
    pub fn free(rule: &str) -> Self {
        Decision { kind: DecisionKind::Free, target: None, length: 0.0, rule: rule.into(), mode: Mode::Normal, alerts: vec![], prompts: vec![], basis: Basis::Idle }
    }
}

/// A repeating window that closed with its obligation unmet.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Missed {
    pub id: ItemId,
    /// The window's deadline.
    pub d: Hours,
    pub habit_floor: bool,
}

/// A next-task model. Implementations must be deterministic functions of the
/// events applied and the times `decide` was called at.
pub trait Model: Send {
    /// A stable name, stored with every logged decision.
    fn name(&self) -> &'static str;
    fn apply(&mut self, e: &Event);
    /// Decides at `now`. May advance internal time (close repeating windows),
    /// but never depends on anything but past events.
    fn decide(&mut self, now: Hours) -> Decision;
    /// Windows that closed unmet so far.
    fn missed(&self) -> &[Missed];
}

/// Applies every event in order.
pub fn replay<M: Model + ?Sized>(m: &mut M, events: &[Event]) {
    for e in events {
        m.apply(e);
    }
}
