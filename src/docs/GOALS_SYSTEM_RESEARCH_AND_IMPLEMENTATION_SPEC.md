# Goals System: Research Basis, Product Direction, and Implementation Specification

**Target application:** Tapestry / Charcoal local-first gamified life system  
**Source baseline reviewed:** `src(13).zip`, data schema 29  
**Document purpose:** Preserve the research-backed product proposal, verify it against the app’s actual direction, and provide an implementation-ready specification.

---

# Part I — Research-Backed Product Proposal

Research supports the earlier direction, but it suggests one deeper structural change:

> The Goals section should distinguish ongoing areas of life from finite goals.

A clean hierarchy would be:

```text
Area / Direction
    Goal
        Milestones
            Tasks, habits, and events
        Updates and evidence

Contribution runs alongside this hierarchy.
```

This is better than treating every broad concern as a goal.

## What the evidence suggests

Specific, challenging goals generally outperform vague instructions, especially when people receive feedback. However, Locke and Latham also warn that uncertain or complex work often needs proximal goals and learning goals rather than a rigid performance target. In other words, “launch the hackathon” can have a clear finish line, while “become better at competitive programming” may need progressive skill stages and experiments rather than a fake completion percentage. ([Locke & Latham, 2002](https://med.stanford.edu/content/dam/sm/s-spire/documents/PD.locke-and-latham-retrospective_Paper.pdf))

Goals also need to connect to concrete situations. A review of 94 studies found that implementation intentions—plans in the form “When X happens, I will do Y”—had a medium-to-large effect on translating intentions into action. ([Gollwitzer & Sheeran, 2006](https://cancercontrol.cancer.gov/sites/default/files/2020-06/goal_intent_attain.pdf))

Progress monitoring is useful, but it should monitor the thing the user actually wants to accomplish. A meta-analysis found that interventions increasing progress monitoring improved goal attainment. This supports visible milestones, measurements, and updates, but not substituting accumulated activity points for actual progress. ([Harkin et al., 2016](https://pubmed.ncbi.nlm.nih.gov/26479070/))

Visible small wins can also improve motivation and satisfaction. Research on the progress principle found that meaningful forward movement—even relatively minor movement—can strongly affect motivation and emotional experience. ([Amabile & Kramer, 2011](https://www.hbs.edu/faculty/Pages/item.aspx?num=40692))

Gamification can help, but its average motivational effect is not enormous or automatic. A meta-analysis of 35 gamified interventions found a small overall effect on intrinsic motivation, with stronger effects on perceived autonomy and relatedness than on competence. Poorly designed systems often failed because users did not feel sufficiently autonomous or capable. ([Li et al., 2024](https://link.springer.com/article/10.1007/s11423-023-10337-7))

That matches self-determination theory: systems are more sustainable when they support autonomy, competence, and relatedness rather than making users feel controlled by external rewards. ([Ryan & Deci, 2000](https://selfdeterminationtheory.org/SDT/documents/2000_RyanDeci_SDT.pdf))

A good system must also allow goals to be paused, revised, or abandoned. Research on unattainable goals found that the ability to disengage and reengage with something meaningful was associated with lower stress, fewer intrusive thoughts, and greater feelings of mastery and purpose, although much of that evidence is correlational. ([Wrosch et al., 2003](https://www.cmu.edu/dietrich/psychology/pdf/scales/GAS_article.pdf))

## The recommended hierarchy

### 1. Area

An Area is an ongoing part of life without a finish line:

- Academics
- Health
- Charcoal
- Research
- Community
- Relationships
- Creative work

Areas answer:

> “What parts of my life am I responsible for or trying to develop?”

They do not have completion percentages.

This distinction is already used successfully in productivity software. Things organizes work through both areas and projects, while allowing projects to sit inside areas; its documentation describes areas as a form of context and responsibility. ([Things official guide](https://culturedcode.com/things/guide/))

### 2. Goal

A Goal is a finite desired outcome inside an Area:

```text
Area: Community
Goal: Run Raven Hacks V2 and distribute prizes
```

A valid Goal needs:

- A clear desired result
- A definition of finished
- An optional target date
- A progress method
- A current status

Goals answer:

> “What change am I trying to produce?”

### 3. Milestone

A Milestone is a meaningful stage in reaching the goal:

```text
Sponsors secured
Registration opened
Judges confirmed
Event conducted
Prizes distributed
```

Milestones should represent stages, not every individual task.

Linear uses a similar structure: projects have clear outcomes, milestones represent stages in the project lifecycle, and milestone progress is visible in higher-level views to contextualize the project’s state. ([Linear milestone documentation](https://linear.app/docs/project-milestones))

### 4. Supporting work

Tasks, habits, events, Dojo sessions, and other activity link upward to a goal or milestone.

Examples:

```text
Task: Email potential sponsors
    → Goal: Run Raven Hacks V2
    → Milestone: Sponsors secured

Habit: Solve three Codeforces problems
    → Goal: Reach Codeforces Master
    → Milestone: Reach Expert
```

This is how ordinary app use contributes to the broader picture without forcing the user to operate from the Goals page all day.

### 5. Evidence and Contribution

Every linked action produces evidence:

- Task completed
- Habit performed
- Session completed
- Milestone reached
- Deadline changed
- Goal update posted
- Blocker added or resolved

Contribution summarizes the volume of meaningful participation.

But the relationship must be:

```text
Contribution = evidence that work happened
Progress = evidence that the desired outcome is closer
```

A user could contribute heavily while a goal remains blocked. Conversely, one decisive action could produce major actual progress with little raw Contribution.

## Goal types

The app should not calculate every goal the same way.

### Project goal

A finite result:

> Release Charcoal 1.0.

Progress is determined by milestones. The interface uses a roadmap rather than a generic percentage.

### Metric goal

A numeric target:

> Reach a 2,100 Codeforces rating.

Progress can use:

```text
Current: 1,620
Target: 2,100
```

A progress bar is appropriate because the measurement has actual meaning.

### Learning goal

An uncertain capability:

> Learn enough machine learning to contribute independently to CaraML.

Progress should use demonstrated stages:

```text
Understand existing architecture
Reproduce baseline model
Implement one supervised change
Evaluate results independently
```

This follows the research distinction between performance goals and learning goals for complex tasks. ([Locke & Latham, 2002](https://med.stanford.edu/content/dam/sm/s-spire/documents/PD.locke-and-latham-retrospective_Paper.pdf))

### Maintenance responsibility

Something like “stay healthy” or “keep my room clean” should usually not be a Goal.

It belongs under:

```text
Area: Health
Habit: Exercise three times per week
```

A temporary maintenance challenge—such as “follow this rehabilitation plan for six weeks”—can still be a finite goal.

## Goals overview

The overview should answer:

> “Where is my life currently going?”

I would organize it as follows.

### Current focus

One goal may be pinned as the current focus.

```text
CURRENT FOCUS

Release Charcoal 1.0

Current milestone
Stabilize persistence and migrations

Next action
Repair theme migration regression

Status
At risk
```

This is not the only active goal. It is simply the one the user has intentionally foregrounded.

### Areas

Show the broader life structure:

```text
Academics        2 active goals
Charcoal         1 active goal
Community        1 active goal
Research         2 active goals
Health           No finite goal
```

Selecting an Area filters the goals beneath it.

The Area should show recent effort distribution, but not label a quiet Area as morally deficient. “No recorded activity this week” is factual; “neglected” is judgmental.

### Active goal cards

Each card should contain only:

- Goal title
- Definition of finished
- Current milestone
- Next action
- Status
- One appropriate progress visualization

For example:

```text
RUN RAVEN HACKS V2

Finished when:
The event is conducted and all prizes are distributed.

Current milestone:
Secure sponsors

Next:
Send revised sponsorship package

● At risk       2 of 5 milestones
Updated 3 days ago
```

Contribution should appear as a small secondary value, not as the card’s main progress bar.

### Attention section

Instead of a general activity feed, show only goals requiring interpretation:

```text
Blocked
No next action
Target date approaching
No update recently
Milestone overdue
Waiting on another person
```

This makes the overview useful rather than decorative.

## Individual Goal page

The Goal page should have this hierarchy.

### Outcome header

```text
RUN RAVEN HACKS V2

Conduct the event and distribute all prizes by September.

Area: Community
Status: At risk
Target: September 30
```

The finish condition should be more visually prominent than Contribution tier, cosmetics, or leaderboard standing.

### Two separate progress tracks

```text
OUTCOME
2 of 5 milestones complete
Current stage: Sponsors secured

CONTRIBUTION
187 accumulated
24 this week
```

Never merge these values.

### Roadmap

```text
✓ Devpost prepared
● Sponsors secured
○ Judges confirmed
○ Event conducted
○ Prizes distributed
```

Selecting a milestone reveals its linked work and evidence.

Progress should accelerate visually near a legitimate finish line because clear proximity can increase motivation, but artificial or invented progress should be avoided. Research on the goal-gradient effect shows that motivation can increase as people perceive themselves approaching a reward. ([Kivetz, Urminsky, & Zheng, 2006](https://home.uchicago.edu/ourminsky/Goal-Gradient_Illusionary_Goal_Progress.pdf))

### Current move

This converts the broad objective into action:

```text
Next action:
Send the revised sponsor package to three organizations.

Plan:
When I finish school on Tuesday, I will send the first email.

Possible obstacle:
I may keep revising the package instead of sending it.

Response:
If I find another noncritical wording issue, I will note it and send
the existing version.
```

The obstacle and response fields implement mental contrasting and implementation-intention principles without turning goal creation into a psychology worksheet. Mental contrasting combined with implementation intentions has shown a positive, though modest and variable, effect on goal attainment across studies. ([Wang et al., 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8149892/))

### Supporting work

Display linked items, but do not reproduce the complete task manager.

```text
4 active tasks
2 supporting habits
1 upcoming event
3 collaborators
```

Selecting one opens it in its native app section.

### Updates and timeline

The timeline records meaningful change:

```text
Jul 27 — Sponsorship package revised
Jul 25 — One sponsor declined
Jul 23 — Matteo assigned to fiscal outreach
Jul 20 — Devpost milestone completed
```

There should also be manual updates:

```text
Post update:
The first sponsor declined, but the package appears too broad.
We are narrowing the tiers before continuing outreach.
```

Linear similarly uses concise project updates to record milestone movement, delays, date changes, ownership changes, and overall progress, with a chronological update history. ([Linear updates documentation](https://linear.app/docs/initiative-and-project-updates))

## Goal creation

The creation flow should be ordered around meaning rather than appearance.

### Step 1: Desired outcome

```text
What are you trying to change or accomplish?
```

The user writes this in their own words.

### Step 2: Definition of finished

```text
What would have to be true for this goal to be complete?
```

The app may identify vagueness:

```text
“Improve at programming” does not have a clear finish condition.

Use as:
[Area] [Learning goal] [Rewrite]
```

The app should assist rather than automatically replace the user’s language. Preserving choice and ownership is consistent with autonomy-supportive design. ([Ryan & Deci, 2000](https://selfdeterminationtheory.org/SDT/documents/2000_RyanDeci_SDT.pdf))

### Step 3: Progress type

```text
How should progress be represented?

○ Milestones
○ Numeric measurement
○ Demonstrated learning stages
```

The user can change this later.

### Step 4: Roadmap

Suggest three to five initial milestones, but allow an incomplete plan. Uncertain goals should be able to evolve.

### Step 5: Supporting work

Link existing tasks and habits or create the first one.

The system should strongly encourage at least one current next action, but should not require the user to plan the entire goal in advance.

### Step 6: Execution plan

```text
When or where are you likely to take the next action?
What could prevent it?
What will you do in response?
```

### Step 7: Appearance

Only after the functional structure exists should the user choose:

- Icon
- Banner
- Theme
- Arena appearance
- Shared visibility

Currently, visual customization appears to have too much structural importance during creation.

## Weekly goal review

A lightweight periodic review would keep the broader picture accurate.

For each active goal:

```text
Status:
On track / At risk / Blocked / Paused

What changed?
What is the current milestone?
What is the next action?
Does the finish condition still make sense?
```

The app can prefill objective information from linked activity. The user only supplies interpretation.

Pausing or revising a goal should not remove Contribution or impose a punishment. The history remains, because the work still happened.

Possible resolution options:

```text
Continue
Revise outcome
Change target date
Pause
Complete
Archive as no longer relevant
Replace with another goal
```

That makes adaptation part of the system rather than framing every change as failure.

## Gamification rules

Contribution should remain because it fits the app’s identity, but it should follow several restrictions:

- Contribution never substitutes for outcome progress.
- Missing a target does not create negative Contribution.
- Revising or abandoning a goal does not erase earned Contribution.
- Milestone completion receives more visual emphasis than point accumulation.
- Cosmetics reward the history built around a goal.
- Leaderboards are optional and secondary.
- Shared competition belongs in a separate Competition tab, not at the top of every goal.
- The user chooses whether a goal is competitive, collaborative, or private.

The app’s game layer should make progress legible and satisfying. It should not make the player feel that the app owns the goal.

## Recommended final structure

```text
GOALS

Overview
    Current focus
    Areas
    Active goals
    Needs attention
    Recent milestones

Goal detail
    Outcome and finish condition
    Actual progress
    Contribution
    Roadmap
    Current move
    Supporting work
    Updates and timeline
    Collaborators
    Cosmetics / competition

Review
    Status changes
    Blockers
    Revisions
    Paused and completed goals
```

The highest-value first revision is relatively contained:

1. Add **Area**, **finish condition**, **current milestone**, **next action**, and **status** to each goal.
2. Separate **actual progress** from **Contribution**.
3. Replace the main leaderboard view with the broader Goals overview.
4. Move rankings, cosmetics, and contributor statistics into a secondary tab.
5. Automatically create timeline evidence from linked app activity.

That would give the Goals section a real function: it would explain what the rest of the app is building toward, while retaining the app’s social and gamified identity.

---

# Part II — Fit With the Direction of the App

The proposal fits the app, but it should be implemented as a **macro layer over existing play**, not as a second task manager.

The source currently treats a goal as a `project` record and already links tasks through `task.projectId`. Completing a linked task creates a Contribution record with `goalUUID`. The Goals interface, however, currently loads goals, Contribution, and players into an “arena” model, then foregrounds tiers, rank, leaderboard position, and manual positive/negative Contribution. This is the exact layer that should change: the underlying linkage is useful, while the presentation and meaning are too competition-centered for a broader-picture workspace.

The revised system should preserve the app’s established rules:

- **Tasks and Dojo measure work.** They remain the places where the user acts.
- **Goals explain what the work is building toward.** They do not become another list of executable tasks.
- **Contribution records that life happened.** It remains permanent history and cosmetic progression, not outcome completion.
- **Points remain effort-oriented.** The Goals system must not introduce a second effort currency.
- **ELO remains competition-specific.** Goal progress must never affect ELO.
- **Coins remain the only randomized reward surface.** Goal progress and milestone state must be deterministic.
- **Journals preserve context.** A journal may be linked as evidence, but linking or writing one should not manufacture goal progress or goal-specific rewards.
- **The world remains persistent and social.** Goals may be private, collaborative, or competitive; collaboration and competition are modes, not assumptions.
- **IGT remains historical truth.** Goal records, milestones, updates, and evidence must carry IGT so historical profile views do not reveal future state.
- **The app stays local-first.** The implementation uses the existing SQLite, repository, migration, compact-backup, domain-invalidation, and operation-ID patterns.
- **The theme system remains structural.** Every Goals component must work across Minimalist, Minimalist Light, Obsidian, Old Windows, Kawaii, Gamification, Pixelated, Dreamcore, and Mature Beige rather than hardcoding one arena appearance.

The main product reframing is:

```text
Current Goals section:
Contribution arena with a goal label

Revised Goals section:
Life roadmap with Contribution identity and optional competition
```

## Product principles specific to this app

1. **The user acts elsewhere and understands here.** Tasks, Habits, Dojo, Events, and Journals remain native work surfaces. Goals aggregate and interpret their evidence.
2. **The system shows consequences rather than fabricating certainty.** It can show completed milestones, metric movement, linked activity, and inactivity. It should not infer that activity automatically equals outcome progress.
3. **One next move, not another backlog.** A goal may expose one current action linked to the existing task system. It must not display a parallel mini-task manager.
4. **Identity grows around meaningful history.** Existing Goal Tier cosmetics remain, but appear after the outcome and roadmap.
5. **No punishment for adaptation.** Pausing, revising, replacing, or abandoning a goal preserves Contribution and history.
6. **Competition is opt-in.** Collaborative goals show people and shared evidence; competitive goals additionally show rankings.
7. **Factual language over moral judgment.** Use “No linked activity in 14 days,” not “Neglected.” Use “Target date passed,” not “Failed.”
8. **Progress must be typed.** Milestone, metric, and learning goals use different representations. No universal fake percentage.
9. **All writes are reconstructable and idempotent.** Automatic evidence must reference a concrete source action and never double-award.
10. **The interface should feel satisfying through clarity and consequence.** Milestone transitions, visible history, and a coherent roadmap are the reward; points are secondary.

---

# Part III — Implementation Specification

## 1. Scope

### In scope

- First-class Areas
- Expanded Goal outcome model
- Milestones / learning stages
- Metric progress
- Current focus and one linked next action
- Health and lifecycle status
- Goal updates and merged timeline
- Goal-to-habit/event/reminder/journal relationships
- Existing task-to-goal linkage
- Contribution as a separate secondary track
- Private, collaborative, and competitive modes
- Weekly review flow
- Migration of existing goals
- Local-first persistence, IGT filtering, compact backups
- Responsive and all-theme UI

### Out of scope for the first release

- AI-generated goal plans
- Automatic claims that a goal is “on track” based only on activity volume
- Networked multi-user synchronization
- Complex dependency graphs between goals
- Weighted milestone mathematics
- Arbitrary user formulas
- Goal-based ELO
- New currencies
- Negative Contribution
- Replacing the existing task recommender

## 2. Information architecture

Goals should become a first-class panel while preserving the current Events route during migration.

```text
Goals
├── Overview
│   ├── Current focus
│   ├── Areas
│   ├── Needs attention
│   ├── Active goals
│   ├── Recent milestones
│   └── Paused / completed
├── Goal detail
│   ├── Overview
│   ├── Roadmap
│   ├── Activity
│   └── People / Competition (conditional)
└── Review
    ├── Active goal check-in
    └── Resolution actions
```

Recommended code ownership:

```text
features/goals/
    pages/Goals/
    components/
    controllers/
    models/
    styles/

domain/goals/
    GoalModel.js
    GoalProgress.js
    GoalAttention.js
    GoalTimeline.js
    GoalTransitions.js
    GoalEvidence.js

data/persistence/
    repositories/GoalRepository.js
    sqlite/SqliteGoalRepository.js
```

The old `features/events/pages/Events/EventsView.jsx` goal exports may temporarily re-export the new components so routing can move without a single destructive refactor.

## 3. Core domain model

### 3.1 Area

An Area is an ongoing responsibility or direction. It never has a completion percentage.

```ts
type GoalArea = {
  UUID: string;
  parent: string;              // profile/player UUID
  name: string;
  description?: string | null;
  icon?: string | null;
  accentColor?: string | null;
  sortOrder: number;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  inGameTimestamp: number;
};
```

Rules:

- Names are unique per profile after trim/case-folding.
- An Area can exist with no goals.
- Archiving an Area does not archive its goals; the UI requires reassignment or “No Area.”
- Areas never award anything.

### 3.2 Goal

Continue using `STORES.project` as the canonical Goal record to preserve task linkage and existing backups.

New fields may remain in `projects.extra_json`, avoiding an invasive alteration of the current `projects` table.

```ts
type Goal = {
  // Existing canonical fields
  UUID: string;
  parent: string;
  name: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  archivedAt?: string | null;
  inGameTimestamp: number;

  // New meaning fields
  areaUUID?: string | null;
  finishCondition: string;
  progressType: 'milestones' | 'metric' | 'learning';
  targetDate?: string | null;

  // Separate state axes
  lifecycleStatus: 'active' | 'paused' | 'completed' | 'archived';
  healthStatus: 'unset' | 'on_track' | 'at_risk' | 'blocked';
  blockedReason?: string | null;

  // Current-move fields
  currentMilestoneUUID?: string | null;
  nextAction?: GoalActionReference | null;
  implementationCue?: string | null;
  obstacle?: string | null;
  obstacleResponse?: string | null;

  // Goal mode
  participationMode: 'private' | 'collaborative' | 'competitive';
  visibility: 'private' | 'participants' | 'friends';

  // Review metadata
  lastReviewedAt?: string | null;
  reviewIntervalDays?: number | null;

  // Existing task/category and identity fields
  taskCategoryEnabled: boolean;
  hideFromTasks: boolean;
  goalIcon?: string | null;
  bannerColor?: string | null;
  bannerImageUrl?: string | null;
  accentColor?: string | null;
  backgroundImageUrl?: string | null;
  contributorTitle?: string | null;
};
```

Do not use one `status` field for both lifecycle and health. “Paused” and “Blocked” are not the same thing.

### 3.3 Goal action reference

A Goal points to one current move without owning a duplicate task.

```ts
type GoalActionReference = {
  entityType: 'todo' | 'task' | 'habit' | 'reminder' | 'event';
  entityUUID: string;
  labelSnapshot: string;
  pinnedAt: string;
};
```

Rules:

- The source entity remains canonical.
- If the source is deleted or completed, the UI shows the snapshot and asks the user to choose the next move.
- A task completion automatically clears the reference only if it points to that exact task.
- The Goals page never edits task execution fields directly; it deep-links to the native surface.

### 3.4 Metric progress

Metric configuration lives on the Goal record in `extra_json`.

```ts
type GoalMetric = {
  unit: string;
  startValue: number;
  currentValue: number;
  targetValue: number;
  direction: 'increase' | 'decrease';
  updatedAt: string;
  source?: 'manual' | 'linked_event' | 'linked_import';
};
```

Progress calculation:

```ts
function getMetricProgress(metric) {
  const span = metric.targetValue - metric.startValue;
  if (span === 0) return metric.currentValue === metric.targetValue ? 1 : 0;
  const raw = (metric.currentValue - metric.startValue) / span;
  return Math.max(0, Math.min(1, raw));
}
```

The same formula works for decreasing targets because the span is negative.

The interface must always show the actual values and unit. A percentage is supplementary.

### 3.5 Milestone

```ts
type GoalMilestone = {
  UUID: string;
  parent: string;               // owning profile
  goalUUID: string;
  title: string;
  description?: string | null;
  kind: 'milestone' | 'learning_stage';
  position: number;
  status: 'not_started' | 'active' | 'blocked' | 'completed' | 'skipped';
  targetDate?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  inGameTimestamp: number;
  completedInGameTimestamp?: number | null;
};
```

Rules:

- A Goal may have zero milestones while it is still being clarified.
- At most one milestone is `active` by default, but the domain should not assume strict linearity forever.
- Completing a milestone does not directly award Points, Coins, ELO, or Goal Contribution.
- Milestone completion creates a timeline/update event and a visual celebration.
- `skipped` is preserved in history and excluded from the completion denominator.
- Reordering changes `position`, not creation history.

### 3.6 Goal update

Goal updates preserve interpretation that cannot be derived from raw actions.

```ts
type GoalUpdate = {
  UUID: string;
  parent: string;               // author profile
  goalUUID: string;
  kind:
    | 'manual'
    | 'review'
    | 'status_change'
    | 'milestone_change'
    | 'metric_change'
    | 'target_change'
    | 'participant_change';
  summary: string;
  healthStatusSnapshot?: Goal['healthStatus'] | null;
  lifecycleStatusSnapshot?: Goal['lifecycleStatus'] | null;
  sourceType?: string | null;
  sourceUUID?: string | null;
  createdAt: string;
  inGameTimestamp: number;
};
```

Posting an update never grants Contribution or Coins.

### 3.7 Goal relationship

Tasks already use `projectId` as their Goal link. A relationship table supports other entity types and optional milestone links.

```ts
type GoalLink = {
  UUID: string;
  parent: string;
  goalUUID: string;
  milestoneUUID?: string | null;
  entityType: 'task' | 'todo' | 'habit' | 'event' | 'reminder' | 'journal' | 'dojo_session';
  entityUUID: string;
  relation: 'supports' | 'evidence' | 'next_action';
  createdAt: string;
  inGameTimestamp: number;
};
```

Invariants:

- Unique `(goalUUID, entityType, entityUUID, relation)`.
- A task’s `projectId` remains the canonical Goal association; a `GoalLink` is only required when linking it to a milestone or assigning a special relation.
- Journals may be `evidence` only. They do not receive Goal Contribution.
- Deleting a Goal removes active links but does not delete source entities or historical Contribution.

### 3.8 Participants

```ts
type GoalParticipant = {
  UUID: string;
  goalUUID: string;
  playerUUID: string;
  role: 'owner' | 'contributor' | 'viewer';
  joinedAt: string;
  inGameTimestamp: number;
};
```

Rules:

- Private goals have only the owner.
- Collaborative goals show participant activity without rank.
- Competitive goals may show a leaderboard.
- Participation mode can change without modifying historical Contribution.

## 4. Persistence and migration

### 4.1 Schema version

Increment:

```ts
export const DATA_SCHEMA_VERSION = 30;
```

Add:

```text
data/persistence/sqlite/migrations/030_goal_system.js
```

### 4.2 SQL tables

```sql
CREATE TABLE goal_areas (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  accent_color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  in_game_timestamp INTEGER NOT NULL DEFAULT 0 CHECK (in_game_timestamp >= 0)
) STRICT;

CREATE UNIQUE INDEX goal_areas_player_name_idx
ON goal_areas(player_id, name COLLATE NOCASE)
WHERE archived_at IS NULL;

CREATE TABLE goal_milestones (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('milestone','learning_stage')),
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('not_started','active','blocked','completed','skipped')),
  target_date TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  in_game_timestamp INTEGER NOT NULL DEFAULT 0 CHECK (in_game_timestamp >= 0),
  completed_in_game_timestamp INTEGER CHECK (
    completed_in_game_timestamp IS NULL OR completed_in_game_timestamp >= 0
  )
) STRICT;

CREATE INDEX goal_milestones_goal_position_idx
ON goal_milestones(goal_id, position, id);

CREATE INDEX goal_milestones_player_igt_idx
ON goal_milestones(player_id, in_game_timestamp, id);

CREATE TABLE goal_updates (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  health_status_snapshot TEXT,
  lifecycle_status_snapshot TEXT,
  source_type TEXT,
  source_id TEXT,
  created_at TEXT NOT NULL,
  in_game_timestamp INTEGER NOT NULL DEFAULT 0 CHECK (in_game_timestamp >= 0)
) STRICT;

CREATE INDEX goal_updates_goal_time_idx
ON goal_updates(goal_id, in_game_timestamp DESC, created_at DESC, id);

CREATE UNIQUE INDEX goal_updates_source_receipt_idx
ON goal_updates(goal_id, source_type, source_id, kind)
WHERE source_id IS NOT NULL;

CREATE TABLE goal_links (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id TEXT REFERENCES goal_milestones(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('supports','evidence','next_action')),
  created_at TEXT NOT NULL,
  in_game_timestamp INTEGER NOT NULL DEFAULT 0 CHECK (in_game_timestamp >= 0)
) STRICT;

CREATE UNIQUE INDEX goal_links_unique_idx
ON goal_links(goal_id, entity_type, entity_id, relation);

CREATE INDEX goal_links_entity_idx
ON goal_links(entity_type, entity_id, goal_id);

CREATE TABLE goal_participants (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','contributor','viewer')),
  joined_at TEXT NOT NULL,
  in_game_timestamp INTEGER NOT NULL DEFAULT 0 CHECK (in_game_timestamp >= 0),
  UNIQUE(goal_id, player_id)
) STRICT;
```

### 4.3 Legacy migration policy

For every existing `project` record:

```ts
{
  finishCondition: project.finishCondition ?? project.description ?? '',
  progressType: project.progressType ?? 'milestones',
  lifecycleStatus:
    project.archivedAt || project.status === 'archived'
      ? 'archived'
      : project.completedAt
        ? 'completed'
        : 'active',
  healthStatus: project.healthStatus ?? 'unset',
  participationMode: project.participationMode ?? 'collaborative',
  visibility: project.visibility ?? 'participants',
  areaUUID: project.areaUUID ?? null,
  reviewIntervalDays: project.reviewIntervalDays ?? 7,
  needsGoalDefinition: !String(project.finishCondition ?? '').trim(),
}
```

Also create one owner participant for every Goal.

Do not automatically create milestones from tasks. Tasks are too granular and would produce a misleading roadmap.

Existing manual positive or negative Contribution records remain historical. The new interface does not create additional negative entries.

### 4.4 Backup compatibility

- Add all new stores/tables to compact export and import.
- Preserve unknown fields in `projects.extra_json`.
- Ensure schema-29 backups migrate deterministically to schema 30.
- Add migration fixtures containing:
  - active legacy goal
  - archived goal
  - goal with task contributions
  - goal with negative legacy manual Contribution
  - goal whose owner profile is archived
- Migration must be idempotent and preserve UUIDs.

## 5. Repository and query layer

### 5.1 Replace broad arena loading

The current overview loads all Goals, all visible Contribution, and all profiles, then constructs every leaderboard in memory. The revised overview should use compact aggregate queries.

Add:

```ts
GoalRepository.getOverview(playerUUID, viewerIGT)
GoalRepository.getGoalDetail(goalUUID, viewerIGT)
GoalRepository.getGoalTimeline(goalUUID, viewerIGT, cursor)
GoalRepository.getGoalParticipants(goalUUID, viewerIGT)
GoalRepository.getLinkedWork(goalUUID, viewerIGT)
GoalRepository.getReviewQueue(playerUUID, now)
```

### 5.2 Overview projection

```ts
type GoalOverviewProjection = {
  areas: GoalArea[];
  currentFocusGoalUUID: string | null;
  activeGoals: GoalCardModel[];
  pausedGoals: GoalCardModel[];
  attentionItems: GoalAttentionItem[];
  recentMilestones: GoalMilestone[];
  summary: {
    activeCount: number;
    blockedCount: number;
    completedThisMonth: number;
    recentContribution: number;
  };
};
```

The SQL projection should aggregate:

- total Goal Contribution
- current-player Goal Contribution
- participant count
- last linked evidence timestamp
- contribution in the last seven days
- completed / eligible milestone counts

Do not build a leaderboard unless the Goal detail requests the Competition tab.

### 5.3 IGT visibility

All new repository reads accept `viewerIGT`.

A row is visible when:

```text
in_game_timestamp <= viewerIGT
```

Completion state is visible only when:

```text
completed_in_game_timestamp IS NULL
OR completed_in_game_timestamp <= viewerIGT
```

Goal detail should not show a future milestone completion, future update, future participant, or future link when viewing an earlier profile state.

Existing Goals should also be filtered by their `inGameTimestamp`; `getAll(STORES.project)` should no longer expose Goals created after the historical viewer point.

## 6. Domain services

### 6.1 Goal progress

Add pure functions:

```ts
buildGoalProgress(goal, milestones)
buildMilestoneProgress(milestones)
buildMetricProgress(goal.metric)
buildLearningProgress(milestones)
```

Return a typed result:

```ts
type GoalProgressModel =
  | {
      type: 'milestones';
      completed: number;
      total: number;
      currentMilestone: GoalMilestone | null;
    }
  | {
      type: 'metric';
      startValue: number;
      currentValue: number;
      targetValue: number;
      unit: string;
      ratio: number;
    }
  | {
      type: 'learning';
      completedStages: number;
      totalStages: number;
      currentStage: GoalMilestone | null;
    };
```

No generic `goal.percentComplete` field should be stored as truth.

### 6.2 Attention rules

`buildGoalAttention` produces factual, deterministic notices.

Initial rules:

```ts
blocked
no_next_action
no_finish_condition
no_current_milestone
target_within_7_days
target_date_passed
current_milestone_overdue
no_linked_activity_14_days
review_due
```

Priority:

```text
blocked
> target date passed
> current milestone overdue
> no finish condition
> no next action
> target within 7 days
> review due
> no linked activity
```

Microcopy examples:

- “Blocked: waiting on sponsor response.”
- “Target date passed on July 24.”
- “No next action is selected.”
- “No linked activity has been recorded in 14 days.”

Do not use guilt-oriented labels.

### 6.3 Lifecycle transitions

Allowed transitions:

```text
active -> paused | completed | archived
paused -> active | completed | archived
completed -> active | archived
archived -> active
```

Requirements:

- Every transition creates a `GoalUpdate`.
- Completion requires confirmation of the finish condition.
- Completion awards the existing `goal-completed` Contribution exactly once using an idempotent source UUID.
- Reopening does not remove the award.
- Archiving is organizational, not an achievement.
- Deleting is allowed only from archived state and preserves Contribution snapshots.

### 6.4 Current focus

Store per-profile focus in `appSettings`:

```ts
{
  key: `goals.currentFocus:${playerUUID}`,
  value: { goalUUID, setAt, inGameTimestamp }
}
```

Rules:

- Only one current-focus Goal per profile.
- Pausing, completing, archiving, or deleting it clears focus.
- Focus is an explicit user choice, not an algorithmic judgment.
- The task recommender may receive a soft feature indicating the focused Goal, but it must not hard-force those tasks.

### 6.5 Goal evidence

Automatic evidence is generated from concrete actions.

#### Task completion

The existing `recordTaskContribution` remains canonical.

Add an idempotent Goal update receipt only when useful for the timeline, or derive the timeline row from the Contribution record. Prefer derivation to avoid duplicate records.

#### Habit completion / quantity / duration

When a Habit has a `supports` link to a Goal:

```ts
recordActionContribution(databaseConnection, player, {
  source: habitActionType,
  sourceUUID: eventLog.UUID,
  goalUUID: link.goalUUID,
  summary: habit.name,
  createdAt: eventLog.createdAt,
  inGameTimestamp: eventLog.inGameTimestamp,
});
```

The existing idempotent action Contribution ID prevents double-awards.

#### Dojo

If a Dojo session is tied to a task linked to a Goal, pass the task’s `projectId` as `goalUUID` when recording the Dojo Contribution.

Do not create an additional Goal reward merely because the task later completes; the Dojo and task are distinct real actions and may each retain their existing global reward behavior.

#### Journal

A linked Journal appears in the timeline as context/evidence only. It produces no new Goal Contribution, Points, Coins, or progress.

#### Manual update

A manual update produces no reward. It may change health, blocker, target, metric value, or interpretation.

#### Milestone completion

Milestone completion changes outcome progress and creates an update. It does not award an additional currency.

## 7. Contribution, identity, and competition

### 7.1 Separation contract

```text
Outcome progress answers: Are we closer to finished?
Contribution answers: How much recorded participation accumulated?
Points answer: How much task effort was completed?
ELO answers: How did the player perform in competition?
Coins answer: What randomized reward was received?
```

No UI component may use one value as a proxy for another.

### 7.2 Goal tiers

Keep `GOAL_TIERS` and existing cosmetic unlocks.

Rename UI labels from generic “Tier” to **Contribution Tier** wherever ambiguity is possible.

Placement:

- Small badge in Goal header
- Full details in “Identity” side panel or tab
- Cosmetics editor after Goal meaning fields
- Never the primary progress display

### 7.3 Manual Contribution

Remove the `REPORT CONTRIBUTION` positive/negative form from the default Goal page.

Replace with:

```text
POST UPDATE
What changed?
Optional status change
Optional blocker
Optional metric update
```

Do not call `recordManualContribution` from the new form.

Keep legacy manual records visible in history with a “Legacy manual report” source label.

### 7.4 Collaboration and competition

#### Private

- Only owner visible
- No participant panel
- No leaderboard

#### Collaborative

- Participant avatars and roles
- Shared Contribution total
- Per-person history available
- No rank numbers, podium, or “gap to next”

#### Competitive

- Adds Competition tab
- Existing leaderboard and podium may be reused
- Ranking remains explicitly Contribution ranking, not outcome ranking
- The overview card still prioritizes outcome progress

## 8. Goals overview UI

### 8.1 Header

Replace:

```text
Shared progress
Track contribution toward shared goals.
```

With:

```text
Goals
See what your work is building toward.
```

Actions:

```text
Review goals
New goal
```

Habits remain accessible through the existing navigation but should not be the conceptual parent of Goals.

### 8.2 Current focus hero

Show only when set.

Content:

- Goal name
- finish condition, one line
- current milestone or metric
- one next action
- health status
- “Work on this” deep link
- “Change focus” action

The hero should not show a leaderboard.

### 8.3 Area strip

Use compact filter chips or cards:

```text
All · Academics 2 · Charcoal 1 · Community 1 · Research 2
```

A quiet Area may show “No active goals,” never a failure warning.

### 8.4 Needs attention

Render only when nonempty.

Each item must include:

- factual reason
- Goal name
- one direct resolution action

Examples:

```text
No next action — Release Charcoal 1.0 — Choose action
Blocked — Raven Hacks V2 — Review blocker
Review due — Reach Codeforces Master — Check in
```

### 8.5 Goal card

Required visual hierarchy:

1. Goal name
2. finish condition
3. typed outcome progress
4. current milestone / stage
5. next action
6. health and target date
7. small Contribution Tier / total
8. participant avatars if shared

Example data model:

```ts
type GoalCardModel = {
  goalUUID: string;
  name: string;
  finishCondition: string;
  area: GoalArea | null;
  lifecycleStatus: Goal['lifecycleStatus'];
  healthStatus: Goal['healthStatus'];
  targetDate: string | null;
  progress: GoalProgressModel;
  nextAction: GoalActionReference | null;
  totalContribution: number;
  contributionTier: number;
  participants: ParticipantSummary[];
  lastMeaningfulActivityAt: string | null;
  attention: GoalAttentionItem[];
};
```

Remove from default cards:

- “your rank”
- “gap”
- “leader”
- podium framing

### 8.6 Recent milestones

Show a small chronological list of completed milestones across Goals. This supplies the satisfying “small wins” layer without turning the entire page into a feed.

## 9. Goal detail UI

### 9.1 Header / hero

Primary:

- name
- finish condition
- Area
- lifecycle state
- health
- target date

Secondary:

- Contribution Tier
- banner / identity
- participant mode

Actions:

```text
Set focus
Edit
Pause / Resume
Complete
More
```

### 9.2 Overview layout

Desktop:

```text
Main column                         Side column
Outcome progress                    Contribution identity
Roadmap preview                     People
Current move                        Goal settings summary
Supporting work
Recent timeline
```

Mobile:

```text
Outcome
Current move
Roadmap
Supporting work
Timeline
Contribution identity
People / Competition
```

### 9.3 Current move panel

Fields:

- linked next action
- implementation cue
- obstacle
- response plan

Actions:

- Open / start source action
- Choose different action
- Clear action

The panel should be concise by default. Cue, obstacle, and response expand under “Plan around friction.”

### 9.4 Roadmap

Behavior:

- Drag to reorder
- Select to open milestone drawer
- Complete, skip, block, or reactivate
- Link tasks/habits/events to a milestone
- Completed milestone gets a short deterministic animation
- No randomized reward animation

For learning Goals, label the section “Stages” rather than “Milestones.”

### 9.5 Supporting work

Summary rows:

```text
Tasks        4 active · 12 completed
Habits       2 linked
Events       1 upcoming
Reminders    1 pending
Journals     3 references
```

Clicking a row opens a compact linked-items drawer. Clicking an item deep-links to its native module.

### 9.6 Timeline

Merge and sort:

- Contribution records
- Goal updates
- milestone transitions
- metric changes
- lifecycle transitions
- participant changes
- linked journal evidence

Group by day and use cursor pagination.

Every row includes:

- source icon
- factual label
- actor
- timestamp / IGT-aware time
- Contribution amount only when an actual Contribution record exists

### 9.7 People / Competition

Conditional rendering:

- private: omitted
- collaborative: people and roles
- competitive: people plus leaderboard

Move the existing podium, rank, gap, and Goal Leaders list into this tab.

### 9.8 Identity / cosmetics

Keep existing tier-gated fields:

- banner color
- banner image
- primary color
- background image
- contributor title

The editor is reached from an “Identity” panel after the functional Goal fields. Locked tier controls remain visible but secondary.

## 10. Goal creation and editing

The research proposal describes seven conceptual steps, but the actual app should use progressive disclosure so creation stays clean.

### 10.1 Quick-create sheet

Required:

1. Goal title
2. Finish condition
3. Area, optional
4. Progress type

Optional collapsed section:

- target date
- private / collaborative / competitive
- show as task category

Primary button:

```text
Create and define roadmap
```

After creation, open the Goal detail in setup state.

### 10.2 Setup checklist

Nonblocking checklist:

```text
Define finish condition     required, already complete
Add a milestone or metric   recommended
Choose a next action        recommended
Set target date             optional
Plan around friction        optional
Choose identity             optional
```

The user can leave at any point. Do not require a long wizard before the Goal exists.

### 10.3 Vague-goal assistance

Use deterministic heuristics only in MVP:

- finish condition fewer than 12 non-whitespace characters
- same normalized text as title
- phrases such as “get better,” “improve,” “work on,” without a measurement or stage

Response:

```text
This may work better as an Area or a learning Goal.
[Keep it] [Use learning stages] [Create as Area]
```

Never block saving and never silently rewrite user text.

### 10.4 Edit form order

```text
Meaning
  title
  finish condition
  Area
  progress type
  target

State
  lifecycle
  health
  blocker

Execution
  current milestone
  next action
  cue / obstacle / response

Participation
  mode
  visibility
  people

Identity
  existing tier-gated cosmetics
```

## 11. Weekly review

### 11.1 Review trigger

Default `reviewIntervalDays = 7`, configurable per Goal or globally.

A review is due when:

```text
now - lastReviewedAt >= reviewIntervalDays
```

Do not force a modal on app launch. Show a Review Goals action and a factual attention item.

### 11.2 Review flow

One Goal at a time:

```text
What changed since the last review?
Health: On track / At risk / Blocked
Is this still the right outcome?
Is the current milestone correct?
What is the next action?
```

Prefill:

- linked activity count
- latest milestone transition
- target date movement
- current blocker
- existing next action

Resolution actions:

```text
Continue
Revise
Pause
Complete
Archive
Replace
```

### 11.3 Replace Goal

“Replace” creates a new Goal and records reciprocal update links:

```text
oldGoal.replacedByGoalUUID
newGoal.replacesGoalUUID
```

The old Goal becomes archived or paused at the user’s choice. No history is erased.

## 12. Recommender integration

The Goal system should supply context to the existing task recommender without becoming a rules engine.

Candidate features:

```ts
isInCurrentFocusGoal: boolean;
isInBlockedGoal: boolean;
isInPausedGoal: boolean;
isNextActionForGoal: boolean;
isInCurrentMilestone: boolean;
daysUntilGoalTarget: number | null;
```

Policy constraints:

- Exclude tasks whose Goal is paused, completed, or archived unless explicitly opened by the user.
- A selected next action may receive a soft ranking feature.
- Current-focus membership may receive a soft feature.
- Blocked Goal tasks are not automatically excluded; the specific blocker may not block every task.
- No fixed hardcoded score bonus in UI code. Feed features through the existing recommender policy/training boundary.
- Persist and version any new encoding features under the recommender schema.

## 13. Domain invalidation and loading

Add or update domains:

```ts
DATA_DOMAIN.goalAreas
DATA_DOMAIN.goalMilestones
DATA_DOMAIN.goalUpdates
DATA_DOMAIN.goalLinks
DATA_DOMAIN.goalParticipants
```

Or, if domain count should remain compact, group these under `DATA_DOMAIN.goals` and use repository-level sub-revisions.

Recommended invalidations:

```ts
goalWrite:
  goals
  competitiveArenas
  tasks
  recommender
  profiles
  profileSummaries

goalEvidenceWrite:
  goals
  competitiveArenas
  profiles
  profileSummaries

goalLinkWrite:
  goals
  tasks
  recommender
  eventTrackers
```

Use the existing panel lifecycle and request-scope cancellation. Overview, detail, timeline, and Competition data should load separately.

## 14. Visual and theme requirements

The Goals redesign must use semantic classes and variables, not Goal-page-specific hardcoded colors.

Required theme matrix:

```text
9 themes × 3 widths = 27 final screenshots
```

Widths:

- desktop
- tablet
- mobile

Required checks:

- no horizontal overflow
- no clipped roadmap labels
- Old Windows controls preserve hard edges and bevel logic
- Pixelated mode uses stepped borders without breaking drag targets
- Kawaii and Dreamcore preserve contrast for statuses
- Minimalist variants suppress nonessential glow
- Obsidian retains readable hierarchy
- Mature Beige preserves status differentiation without neon dependence
- Gamification may emphasize Contribution identity but not reorder information hierarchy

Do not encode meaning by color alone. Every status requires a text label and/or icon.

## 15. Interaction and satisfaction rules

Use deterministic, restrained feedback:

- Milestone completion: check transition, path fill, short sound from the active theme sound pack if enabled
- Goal completion: stronger but brief sequence, then reveal preserved history
- Linking work: immediate appearance in Supporting Work
- Posting update: inserts into timeline without reward float
- Setting current focus: visible hero transition
- Progress changes: animate from previous real value to new real value

Avoid:

- confetti for routine edits
- fake progress initialization
- positive/negative point toggles
- rank changes on noncompetitive Goals
- punishment animation for overdue targets
- full-screen blocking celebrations

## 16. Accessibility

- Full keyboard operation for milestone reorder, with Move Up / Move Down alternatives
- Focus restoration after drawers and modals
- `aria-live="polite"` for status and progress updates
- Reduced-motion mode removes path animation and scale effects
- All progress elements include textual equivalents
- Minimum touch target 44×44 CSS pixels on mobile
- Goal health, lifecycle, and milestone state never depend only on hue
- Screen-reader labels distinguish “Outcome progress” from “Contribution Tier progress”

## 17. Testing specification

### 17.1 Domain tests

```text
GoalProgress.test.mjs
  milestone denominator excludes skipped
  zero-milestone state
  increasing metric
  decreasing metric
  zero-span metric
  learning stage current state

GoalAttention.test.mjs
  priority order
  no guilt language
  target boundaries
  inactivity boundaries
  review due calculation

GoalTransitions.test.mjs
  allowed transitions
  completion award idempotency
  reopen preserves Contribution
  archive does not award

GoalEvidence.test.mjs
  linked habit creates one Contribution
  retry does not duplicate
  journal link creates no reward
  milestone completion creates no reward
```

### 17.2 Persistence tests

```text
migration030.test.mjs
  schema-29 migration
  UUID preservation
  legacy Contribution preservation
  owner participant creation
  backup round trip

SqliteGoalRepository.test.mjs
  IGT visibility
  overview aggregation
  detail lazy queries
  source receipt uniqueness
  delete keeps Contribution snapshots
```

### 17.3 UI tests

```text
GoalsOverview.test.mjs
  focus hero
  Area filtering
  attention resolution
  card hierarchy
  no leaderboard in default view

GoalDetail.test.mjs
  typed progress
  current move deep link
  roadmap transitions
  update creates no reward
  conditional Competition tab

GoalForm.test.mjs
  quick-create minimum
  progressive setup
  vague-goal assistance is nonblocking
```

### 17.4 Integration tests

- Completing a linked task updates timeline and Contribution once.
- Completing a linked Habit updates timeline and Contribution once.
- Completing an unlinked Habit does not affect a Goal.
- A linked Journal appears as evidence without reward.
- Pausing a Goal removes its tasks from ordinary recommender eligibility.
- Viewing a profile at earlier IGT hides future milestones and updates.
- Switching profiles preserves separate current-focus selections.
- Deleting an archived Goal does not alter player Contribution totals.
- Compact backup and restore reproduce the complete Goal workspace.

### 17.5 Visual regression

Generate the 27-shot theme matrix for:

- populated overview
- empty overview
- Goal detail
- roadmap drawer
- creation sheet
- weekly review

The full matrix can be generated for the principal overview and detail pages, with targeted component captures for secondary surfaces.

## 18. Performance requirements

- Goals overview interactive within the same budget as the existing Events panel.
- No full leaderboard construction on overview load.
- Timeline page size: 30 rows.
- Participant / Competition data lazy-loads only when opened.
- Overview query returns aggregate projections, not every Contribution record.
- No image blobs loaded until a visible Goal banner requests them.
- Progressive list remains available for large Goal archives.
- All request results honor panel request cancellation.

## 19. Rollout plan

### Phase 1 — Meaning and progress foundation

- Add Goal fields in `extra_json`
- Add schema-30 tables
- Add Areas, milestones, updates, links, participants
- Add domain progress and transition functions
- Migrate existing Goals
- Keep old UI temporarily operational

### Phase 2 — Overview and detail replacement

- Build Goals overview
- Build typed Goal cards
- Build Goal detail outcome / roadmap / current move
- Replace manual Contribution form with Post Update
- Move Contribution Tier to secondary panel

### Phase 3 — App integration

- Habit links and idempotent Goal evidence
- Dojo Goal context
- Journal evidence links
- task recommender Goal features
- IGT-aware timeline
- weekly review

### Phase 4 — Social and identity

- private / collaborative / competitive modes
- participant roles
- Competition tab
- migrate existing leaderboard UI
- cosmetics / identity panel

### Phase 5 — Hardening

- compact backup round trip
- migration recovery tests
- 27-shot theme matrix
- performance profiling
- accessibility pass
- production-origin console must remain at zero errors

## 20. Acceptance criteria

The redesign is complete when all of the following are true:

1. Opening Goals immediately answers what the user is pursuing, what is currently important, and what needs attention.
2. Every Goal has a visible finish condition or a clear “needs definition” state.
3. Outcome progress and Contribution are displayed as separate concepts in every view.
4. Milestone, metric, and learning Goals use different accurate representations.
5. A Goal exposes at most one selected current move and deep-links to the native work surface.
6. Existing linked task completion still produces Goal Contribution exactly once.
7. Linked Habit activity can contribute exactly once; linked Journals cannot generate Goal rewards.
8. Manual Goal updates cannot create Contribution, Points, Coins, or ELO.
9. Pausing, revising, replacing, or archiving a Goal never erases historical Contribution.
10. Leaderboards are absent unless the Goal is explicitly competitive.
11. Historical IGT views never reveal future Goal state.
12. Existing schema-29 saves migrate without data loss.
13. Compact export/import preserves all new Goal data.
14. The interface passes desktop, tablet, and mobile QA across all nine visual themes.
15. The Goals overview does not load all Contribution rows or construct all leaderboards eagerly.
16. The task recommender respects paused/completed/archived Goals and treats focus as a soft signal.
17. All new automatic evidence writes are idempotent.
18. The production build, SQLite runtime build, automated tests, and production-origin console pass.

---

# Part IV — Recommended First Implementation Batch

This is the smallest batch that materially changes the product without requiring the entire system at once.

## Batch A: Broader-picture MVP

### Data

Add to existing Goal records:

```ts
areaUUID
finishCondition
progressType
lifecycleStatus
healthStatus
targetDate
currentMilestoneUUID
nextAction
lastReviewedAt
participationMode
visibility
```

Add schema-30 tables:

```text
goal_areas
goal_milestones
goal_updates
goal_participants
```

Defer `goal_links` except for task linkage until Batch B if migration risk is high.

### UI

Replace current Goal arena overview with:

```text
Current focus
Needs attention
Area filters
Active Goal cards
Paused / completed
```

Replace default Goal detail body with:

```text
Outcome
Roadmap
Current move
Recent evidence
Contribution identity
```

Move leaderboard into a conditional Competition drawer/tab.

Replace manual Contribution report with Post Update.

### Existing integration retained

- Tasks continue to use `projectId`.
- Task completion continues to create Goal Contribution.
- Goal Tier cosmetics remain.
- Archive/delete behavior remains, with clearer lifecycle semantics.
- All source records preserve existing UUIDs.

### Batch A success test

A user should be able to create:

```text
Area: Community
Goal: Run Raven Hacks V2
Finished when: The event is held and all prizes are distributed.
Milestones: Sponsors → Judges → Event → Prizes
Current move: Send revised sponsor package
Health: At risk
```

They should then see task-generated Contribution accumulate without the app claiming that Contribution itself is completion progress.

## Batch B: Full app contribution

- Link Habits, Events, Reminders, and Journals
- Derive timeline evidence
- Add IGT filtering for all Goal subrecords
- Add weekly review
- Add recommender features

## Batch C: Social modes and refinement

- Participant management
- collaborative mode
- competitive mode
- leaderboard migration
- identity/cosmetic refinement
- full theme and accessibility QA

---

# Sources

1. Locke, E. A., & Latham, G. P. (2002). *Building a Practically Useful Theory of Goal Setting and Task Motivation.*  
   https://med.stanford.edu/content/dam/sm/s-spire/documents/PD.locke-and-latham-retrospective_Paper.pdf

2. Gollwitzer, P. M., & Sheeran, P. (2006). *Implementation Intentions and Goal Achievement: A Meta-Analysis of Effects and Processes.*  
   https://cancercontrol.cancer.gov/sites/default/files/2020-06/goal_intent_attain.pdf

3. Harkin, B., et al. (2016). *Does Monitoring Goal Progress Promote Goal Attainment? A Meta-Analysis of the Experimental Evidence.*  
   https://pubmed.ncbi.nlm.nih.gov/26479070/

4. Amabile, T. M., & Kramer, S. J. (2011). *The Progress Principle.*  
   https://www.hbs.edu/faculty/Pages/item.aspx?num=40692

5. Li, M., et al. (2024). *Gamification enhances student intrinsic motivation, perceptions of autonomy and relatedness, but minimal impact on competency: a meta-analysis and systematic review.*  
   https://link.springer.com/article/10.1007/s11423-023-10337-7

6. Ryan, R. M., & Deci, E. L. (2000). *Self-Determination Theory and the Facilitation of Intrinsic Motivation, Social Development, and Well-Being.*  
   https://selfdeterminationtheory.org/SDT/documents/2000_RyanDeci_SDT.pdf

7. Wrosch, C., Scheier, M. F., Miller, G. E., Schulz, R., & Carver, C. S. (2003). *Adaptive Self-Regulation of Unattainable Goals.*  
   https://www.cmu.edu/dietrich/psychology/pdf/scales/GAS_article.pdf

8. Kivetz, R., Urminsky, O., & Zheng, Y. (2006). *The Goal-Gradient Hypothesis Resurrected.*  
   https://home.uchicago.edu/ourminsky/Goal-Gradient_Illusionary_Goal_Progress.pdf

9. Wang, G., et al. (2021). *A Meta-Analysis of the Effects of Mental Contrasting With Implementation Intentions on Goal Attainment.*  
   https://pmc.ncbi.nlm.nih.gov/articles/PMC8149892/

10. Cultured Code. *Getting Productive with Things — Areas and Projects.*  
    https://culturedcode.com/things/guide/

11. Linear. *Project Milestones.*  
    https://linear.app/docs/project-milestones

12. Linear. *Initiative and Project Updates.*  
    https://linear.app/docs/initiative-and-project-updates
