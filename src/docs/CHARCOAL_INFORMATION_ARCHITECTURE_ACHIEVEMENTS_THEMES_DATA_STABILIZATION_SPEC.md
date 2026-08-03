# Charcoal Information Architecture, Achievements, Theme Depth, and Data Stabilization Specification

**Target application:** Tapestry / Charcoal  
**Baseline archive inspected:** `tapestry-stabilization-all-themes-source.zip`  
**Document type:** Production redesign and implementation specification  
**Status:** Normative  
**Scope:** Information density, subpage architecture, feature integration, achievements v2, persistence integrity, historical-data migration, theme-system expansion, testing, and final source packaging

---

# 0. Executive decision

Charcoal has reached a stage where its primary usability risk is no longer missing functionality. It is **feature convergence**: many valuable systems now compete for space, attention, and responsibility on the same surfaces.

The correct response is not to remove the app’s richness or turn it into a conventional minimal task manager. The response is to give the richness a clearer architecture:

> **The World establishes place. Overviews establish state. Subpages establish purpose. Detail views support focused action. Drawers preserve context. Next Move connects the routes.**

This specification therefore requires five coordinated changes:

1. **Restructure dense features into focused subpages.**
2. **Replace the existing achievement catalog with a more meaningful, safer, and better-integrated system.**
3. **Audit how all major features exchange data and hand off responsibility.**
4. **Harden persistence, migrations, historical-data backfills, backups, and regression testing.**
5. **Deepen themes into complete visual identities and add a limited number of genuinely distinct new themes.**

These changes must be implemented together as one coherent product revision. They must not become isolated cosmetic patches.

---

# 1. Baseline source assessment

The current source is already architecturally substantial. It contains:

- dynamic feature boundaries in `app/shell/GameHub/panelRegistry.js`;
- panel lifecycle and domain invalidation systems;
- Goals, milestones, review cadence, and outcome-progress infrastructure;
- the Next Move phase navigator and edge-accessed surface;
- Feed and Chronicle projections over canonical Chronicle records;
- Profile Context and Social World projections;
- fixed 2v2 Pair Match infrastructure;
- SQLite migrations through `035_feed_chronicle.js`;
- repository and service layers for major domains;
- theme registry and structural theme CSS;
- event-driven achievement counters and receipts;
- compact import/export and backup infrastructure;
- hundreds of source-level tests.

The source also shows clear density pressure. The largest feature components include approximately:

| Surface | Current file |
|---|---|
| Shop | `features/shop/pages/Shop/Shop.jsx` |
| Profile | `features/profile/pages/Profile/Profile.jsx` |
| Events | `features/events/pages/Events/EventsView.jsx` |
| Match Arena | `features/matches/components/MatchArena/MatchArena.jsx` |
| Settings | `features/settings/pages/Settings/Settings.jsx` |
| Tasks | `features/tasks/components/TodoList/TodoList.jsx` |

Large source files are not proof of poor UX, but in this case they correspond to views that support several distinct user intentions at once.

The present achievement system also contains incentives that conflict with Charcoal’s newer direction. Examples include:

- completing 10 or 20 tasks in one day;
- completing an 8-hour task session;
- winning 100 matches consecutively;
- writing 10,000 words in one Feed post;
- owning every paid cosmetic;
- maximizing friend count;
- carrying 70% of a 2v2 team score;
- maintaining consecutive-day task streaks.

These may be technically measurable, but several reward volume, endurance, social accumulation, or internal teammate competition rather than meaningful life progress.

The present theme system is significantly better than a palette switcher. It already changes shape, density, motion, sound, material, typography, texture, and some global chrome across nine themes. However, its deepest structural differences remain concentrated in the global shell and CSS overrides. Feature-specific composition, iconography, illustration, information hierarchy, and page grammar can be made substantially more distinct.

---

# 2. Research basis

## 2.1 Progressive disclosure and cognitive load

Progressive disclosure reduces initial complexity by moving advanced or secondary material to later screens. It works when the visible first layer supports the user’s primary task and deeper navigation has clear information scent. It does not justify hiding frequently needed controls or fragmenting one coherent workflow into arbitrary pages.

Relevant sources:

- Nielsen Norman Group, “Progressive Disclosure”  
  https://www.nngroup.com/articles/progressive-disclosure/
- Nielsen Norman Group, “4 Principles to Reduce Cognitive Load in Forms”  
  https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/
- Nielsen Norman Group, “Minimize Cognitive Load to Maximize Usability”  
  https://www.nngroup.com/articles/minimize-cognitive-load/

Product implication:

> Create subpages when they answer different user questions. Do not create subpages merely because a file or page is long.

## 2.2 Gamification and achievements

Gamification can support motivation when it strengthens autonomy, competence, relatedness, meaningful feedback, and connection to the underlying activity. Evidence is heterogeneous, and poorly chosen points, badges, leaderboards, and competitions can produce motivational problems, irrelevance, worse performance, gaming, or cheating.

Relevant sources:

- Ryan and Deci, Self-Determination Theory  
  https://selfdeterminationtheory.org/SDT/documents/2000_RyanDeci_SDT.pdf
- Ryan, Rigby, and Przybylski, “The Motivational Pull of Video Games”  
  https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf
- Rutledge et al., “Gamification in Action”  
  https://selfdeterminationtheory.org/wp-content/uploads/2020/10/2018_RutledgeWalshEtAl_Gamification.pdf
- Li et al., meta-analysis of gamification and intrinsic motivation  
  https://link.springer.com/article/10.1007/s11423-023-10337-7
- Almeida et al., “Negative Effects of Gamification in Education Software”  
  https://arxiv.org/abs/2305.08346
- Calefato et al., GitHub achievement study  
  https://arxiv.org/abs/2303.14702

Product implication:

> Achievements should commemorate meaningful evidence and reveal growth. They should not manufacture unhealthy target behavior merely because it is easy to count.

## 2.3 Database evolution and historical data

Backward-incompatible changes are safer when implemented through an expand–migrate–contract sequence. Database changes should be versioned, reproducible, reversible where practical, and shipped with the application. SQLite provides explicit integrity and foreign-key checks that should be part of the release process.

Relevant sources:

- Martin Fowler, “Parallel Change”  
  https://martinfowler.com/bliki/ParallelChange.html
- Martin Fowler, “Evolutionary Database Design”  
  https://martinfowler.com/articles/evodb.html
- SQLite PRAGMA documentation  
  https://sqlite.org/pragma.html
- SQLite foreign-key documentation  
  https://sqlite.org/foreignkeys.html

Product implication:

> Existing saves are production data. A redesign is incomplete until old saves upgrade safely, derived views rebuild correctly, and import/export round trips are verified.

## 2.4 Accessibility and scaling

WCAG applies to dynamic web applications and provides testable requirements involving reflow, text resizing, non-text contrast, focus, keyboard operation, pointer input, and motion.

Relevant sources:

- W3C WCAG overview  
  https://www.w3.org/WAI/standards-guidelines/wcag/
- WCAG 2.2 quick reference  
  https://www.w3.org/WAI/WCAG22/quickref/
- WCAG 2.1  
  https://www.w3.org/TR/WCAG21/

Product implication:

> Density reduction cannot be achieved through smaller text or compressed controls. Every subpage and theme must remain usable at increased scale and narrow widths.

## 2.5 Design tokens and multi-theme systems

Design tokens provide a shared source of truth for stylistic decisions across colors, typography, spacing, motion, shape, and other design attributes. They reduce drift but do not themselves create distinctive art direction.

Relevant sources:

- W3C Design Tokens Community Group  
  https://www.w3.org/community/design-tokens/
- W3C Design Tokens stable-version announcement  
  https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/

Product implication:

> Themes need a common semantic contract, but each theme should provide its own component recipes and visual grammar rather than only overriding primitive variables.

---

# 3. Governing product philosophy

## 3.1 Richness is allowed; simultaneous demand is not

Charcoal may remain large, social, immersive, reflective, competitive, and highly configurable.

The constraint is:

> A surface should not ask the user to understand several unrelated systems at the same moment.

## 3.2 Every screen must have a dominant question

Examples:

- **Tasks / Now:** What should I work on now?
- **Tasks / Planning:** Which tasks cannot become executable yet?
- **Goal / Overview:** Where is this goal currently going?
- **Goal / Roadmap:** What stages remain?
- **Profile / Context:** What situation surrounds this person?
- **Profile / History:** How did this person arrive here?
- **Match / Current:** What is happening in this competition?
- **Settings / Data:** Can I trust, export, restore, and inspect my save?

## 3.3 Subpages are not duplicated systems

The new navigation must preserve canonical data:

```text
One task record
→ Now
→ Queue
→ Planning
→ History

One Goal record
→ Overview
→ Roadmap
→ Activity
→ Review

One Chronicle Entry
→ Feed
→ Chronicle
→ Story
→ Essay reader
→ Revisit
```

No subpage may create a parallel editable copy of the same object.

## 3.4 Next Move is the connective layer

Additional pages increase structural clarity but can increase navigational distance.

Next Move must therefore deep-link to exact destinations:

```text
Tasks → Planning → College Essay → Define next action
Goals → Charcoal → Review → Choose next milestone
Profile → Context → Confirm deadline-period summary
Match Arena → Current Match → Teammate context
Settings → Data & Backup → Verify save
```

It must never stop at a generic parent page when the required operation is known.

---

# 4. Global information architecture

## 4.1 Navigation levels

Charcoal should use no more than these levels:

```text
Level 0: World / global shell
Level 1: Major destination
Level 2: Local subpage
Level 3: Entity detail or atomic workflow
```

Avoid deeper nesting.

Example:

```text
World
→ Goals
→ Roadmap
→ Milestone detail
```

Do not create:

```text
World
→ Goals
→ Goal management
→ Roadmap administration
→ Milestone configuration
→ Dependency editor
```

## 4.2 Local-navigation component

Create a shared local-navigation primitive:

```ts
type LocalPageDefinition = {
  id: string;
  label: string;
  icon?: ReactNode;
  summary?: string;
  badge?: number | string;
  deepLinkKey: string;
  lazyComponent: React.LazyExoticComponent<any>;
  requiredDomains: string[];
};
```

Required component:

```text
shared/navigation/LocalSectionNav/
    LocalSectionNav.jsx
    LocalSectionNav.css
    LocalSectionRouteOutlet.jsx
    LocalSectionRouteState.js
```

Responsibilities:

- stable location and order;
- keyboard navigation;
- clear selected state;
- compact and expanded forms;
- responsive collapse;
- per-page deep links;
- preserved scroll and filter state;
- panel-lifecycle integration;
- no remount of expensive subpages unless explicitly disposed;
- accessible page titles and landmarks.

## 4.3 Overview requirements

Every major Overview must contain only:

- current state;
- one primary action;
- at most three attention items;
- concise summaries of deeper sections;
- direct links into those sections.

An Overview must not contain:

- complete tables;
- complete history;
- every setting;
- every editor;
- all analytics;
- full browse catalogs.

## 4.4 Drawer, modal, and subpage rules

Use a **subpage** when content:

- represents a recurring intention;
- needs direct navigation;
- has its own filtering, editing, or history;
- deserves a deep link;
- is large enough to remain open while the user works.

Use a **drawer** when content:

- explains or previews an item in the current context;
- supports comparison without losing the current surface;
- can be dismissed without abandoning an unfinished workflow.

Use a **modal** when content:

- is atomic;
- creates or confirms one thing;
- must block accidental interaction until resolved;
- does not need to become a stable navigation destination.

Use an **accordion** only for optional detail inside one coherent task.

---

# 5. Required feature restructuring

# 5.1 World homepage

The Social World remains the homepage and identity anchor.

The World itself should not become a dense dashboard. It should show:

- Commons as the spatial anchor;
- inhabited locations;
- current recommendation route;
- coarse Fellow context;
- active or imminent shared events;
- location state;
- compact recent traces.

Detailed management belongs inside destinations.

The World must not render:

- full Goal editors;
- full task queues;
- complete Fellow schedules;
- complete Feed;
- achievement catalogs;
- full Match history;
- Settings.

The existing recommendation route remains, with the separately specified marker scaling fix.

---

# 5.2 Tasks

Create local subpages:

```text
Now
Queue
All Tasks
Planning
History
```

## Now

Question:

> What work state should I act on now?

Contains:

- active session dock;
- Next Move work recommendation;
- current action rationale;
- interrupted-session continuation;
- immediate deadline or fixed commitment;
- at most two alternatives;
- session-close transition.

Does not contain:

- complete database;
- bulk editing;
- every reminder;
- long history;
- all planning receipts.

## Queue

Question:

> Which executable tasks are currently available and how are they ranked?

Contains:

- recommender-ranked executable work;
- estimated session lengths;
- feasibility state;
- filters relevant to execution;
- manual preview;
- queue-specific removal or deferral.

## All Tasks

Question:

> What tasks exist and how do I maintain them?

Contains:

- search;
- project, Area, Goal, status, and date filters;
- bulk maintenance;
- archived and completed visibility;
- create task;
- edit task;
- data-quality warnings.

## Planning

Question:

> Which tasks cannot become executable because they lack structure?

Contains:

- `#plan` tasks;
- invalid or missing Plan Receipts;
- blocked tasks;
- undefined next actions;
- changed-scope tasks;
- day-orientation items;
- plan history;
- one-task-at-a-time clarification workflows.

## History

Question:

> What work actually occurred?

Contains:

- completed sessions;
- progressed sessions;
- blocked and stopped outcomes;
- task completion events;
- time and points evidence;
- trends;
- exportable work ledger.

## Source changes

Refactor:

- `features/tasks/components/TodoList/TodoList.jsx`
- `features/tasks/components/TodoList/TodoListView.jsx`

Create:

```text
features/tasks/pages/TasksShell/
features/tasks/pages/TaskNowPage/
features/tasks/pages/TaskQueuePage/
features/tasks/pages/AllTasksPage/
features/tasks/pages/TaskPlanningPage/
features/tasks/pages/TaskHistoryPage/
```

Preserve the existing task domain and recommender. This is a presentation and routing refactor, not a second task system.

---

# 5.3 Goals

For the Goals collection:

```text
Overview
Areas
Reviews
Completed
```

For one Goal:

```text
Overview
Roadmap
Activity
People
Review & Settings
```

## Goals Overview

Contains:

- current focus;
- active Goals;
- attention items;
- broad Area distribution;
- recent milestone movement;
- review-due summary.

## Areas

Contains:

- ongoing life areas;
- active Goals within each;
- work distribution;
- Area descriptions;
- inactive or unrepresented Areas.

## Reviews

Contains:

- scheduled Goal check-ins;
- overdue reviews;
- recently reviewed Goals;
- review outcomes;
- Next Move links.

## Completed

Contains:

- completed, archived, replaced, or abandoned Goals;
- finish evidence;
- retrospective summaries;
- resulting landmarks or Chronicle links.

## Goal Overview

Contains only:

- definition of finished;
- current status;
- current milestone;
- next action;
- main blocker;
- actual progress;
- compact Contribution summary.

## Roadmap

Contains:

- milestone sequence;
- dependencies;
- current phase;
- future stages;
- milestone editing;
- completed-stage evidence.

## Activity

Contains:

- linked tasks;
- habits;
- events;
- sessions;
- timeline;
- updates;
- evidence.

## People

Contains:

- contributors;
- responsibility;
- shared context;
- collaboration history;
- visibility.

## Review & Settings

Contains:

- check-in frequency;
- status;
- target date;
- finish condition;
- progress representation;
- visibility;
- pause, complete, replace, and archive actions.

The setting currently labeled **Review** must use clearer wording such as **Check-in frequency**.

---

# 5.4 Profile

Replace the current broad tab responsibilities with:

```text
Overview
Context
History
Competition
Identity
```

## Overview

Contains:

- current chapter;
- main direction;
- current presence;
- selected achievements;
- recent highlights;
- concise major statistics;
- routes to deeper views.

## Context

Contains:

- Now;
- near horizon;
- recent arc;
- current pressures;
- how to show up;
- audience controls;
- context suggestions and provenance.

## History

Contains:

- Daybook;
- Chronicle;
- timeline modes;
- eras;
- later reflections;
- replay;
- historical profile projection.

The retrospective-dialogue update must replace “Respond without pressure” with Write Back, Add Later Reflection, Carry Forward, and What Happened Afterward.

## Competition

Contains:

- current Elo and rank;
- nearby ladder;
- Match history;
- teammate records;
- recurring pair history;
- competitive trends;
- selected Match achievements.

## Identity

Contains:

- biography;
- titles;
- selected achievements;
- banner;
- theme;
- profile blocks;
- cosmetic configuration;
- profile-specific visibility;
- profile management.

## Source changes

Refactor:

- `features/profile/pages/Profile/Profile.jsx`
- `features/profile/pages/Profile/ProfileView.jsx`
- `features/profile/pages/Profile/ProfileDataController.js`

Keep domain aggregation in the controller. Do not move broad reads back into subpage components.

---

# 5.5 Match Arena

Create:

```text
Arena
Current Match
Standings
History
```

## Arena

Contains:

- Queue;
- available pair-match state;
- brief fixed rules;
- teammate and opponent context preview;
- one Queue action;
- upcoming or resumed Match.

There must be no Match Settings subpage. The fixed ruleset remains fixed.

## Current Match

Contains:

- 2v2 team totals;
- individual contributions;
- work state;
- teammate context;
- opponent context;
- Match event feed;
- task controls;
- final transition to recap.

## Standings

Contains:

- nearby Elo neighborhood;
- division boundary;
- recent rating movement;
- only relevant nearby profiles;
- no distant global-top list.

## History

Contains:

- recaps;
- teammate records;
- opponent series;
- context snapshots;
- rating changes;
- completed work ledger.

## Required reversal

Delete or remove any remaining user-facing Match configuration for:

- duration;
- mode;
- intensity;
- rating;
- visibility;
- score cadence;
- Goal linkage;
- alternate rulesets.

Accessibility and privacy settings remain global/profile settings, not Match rules.

---

# 5.6 Events, Habits, Calendar, and Reviews

The current Events feature should become a shell with:

```text
Calendar
Habits & Rhythms
Day Boundaries
Review Schedule
```

## Calendar

Contains:

- scheduled events;
- deadlines;
- fixed commitments;
- day and week views;
- event details;
- conflicts.

## Habits & Rhythms

Contains:

- cadence definitions;
- intended opportunities;
- reliability;
- continuity;
- habit history;
- quantity and duration controls.

Do not structurally privilege strict streaks.

## Day Boundaries

Contains:

- optional Arrival context;
- optional Handoff;
- wake and sleep historical records;
- no compliance rewards or penalties.

## Review Schedule

Contains:

- Goal check-ins;
- weekly review;
- Chronicle revisit opportunities;
- scheduled planning boundaries;
- no generic “open the app” obligations.

---

# 5.7 Feed and Chronicle

Preserve the finalized single-source architecture.

Feed:

```text
Recent
Wander
Stories
Essays
```

Chronicle:

```text
Latest
Stories
Essays
Revisit
Archive
```

These are projections over the same Chronicle Entry records.

Do not create separate editable databases for:

- Feed posts;
- Moments;
- Essays;
- Stories;
- Revisit items.

Stories store ordering and relations. Addenda are new linked entries by design.

---

# 5.8 Shop and Inventory

Shop:

```text
Featured
Browse
Collections
History
```

## Featured

- newly available items;
- current affordable highlights;
- limited contextual presentation;
- no engagement-pressure timer unless a real item rule requires one.

## Browse

- complete catalog;
- category filtering;
- search;
- item preview;
- ownership state.

## Collections

- coherent cosmetic sets;
- theme-related items;
- completion without requiring full-catalog acquisition for identity or achievement.

## History

- purchases;
- economy transactions related to Shop;
- refunds or reversals;
- source receipts.

Inventory:

```text
Equipped
Collection
Themes
Banners & Identity
```

Shop and Inventory must not duplicate the same purchase or equip state.

---

# 5.9 Settings

Create true settings subpages:

```text
General
Appearance & Themes
Notifications
Privacy & Social
Accessibility
Data & Backup
Advanced
```

## General

- app behavior;
- default profile;
- ordinary navigation;
- day and time conventions.

## Appearance & Themes

- theme preview;
- apply;
- density preview;
- sound preview;
- banner and cosmetic links;
- reduced visual intensity where applicable.

## Notifications

- allowed classes;
- budgets;
- cooldowns;
- delivery behavior;
- notification ledger.

## Privacy & Social

- context audiences;
- presence;
- profile visibility;
- Chronicle visibility defaults;
- Match context projections.

## Accessibility

- reduced motion;
- sound;
- text scale;
- contrast;
- keyboard behavior;
- color-vision accommodations.

## Data & Backup

- save location;
- download save;
- compact backup;
- restore;
- integrity verification;
- export manifest;
- migration status;
- last verified backup.

## Advanced

- recommender checkpoint;
- diagnostic logs;
- cache rebuild;
- achievement reconciliation;
- migration report;
- destructive reset actions.

---

# 6. Cross-feature integration audit

The implementation must verify the application as a system.

# 6.1 Canonical ownership map

| Concept | Canonical owner |
|---|---|
| Task definition | Task domain |
| Work session evidence | Task session / continuity domain |
| Goal outcome | Goal domain |
| Milestones | Goal domain |
| Habit cadence | Events/Habits domain |
| Chronicle writing | Chronicle Entry |
| Story membership | Chronicle Story relations |
| Feed visibility | Chronicle social projection |
| Profile Context | Profile Context domain |
| Match result | Match domain |
| Rating | Rank/Elo domain |
| Contribution | Contribution domain |
| Coins and purchases | Economy/Shop domain |
| Achievement evidence | Achievement events and receipts |
| Theme identity | Theme Registry and semantic tokens |
| World location state | Social World projections |

No feature may silently become a second owner.

# 6.2 Required handoffs

## Tasks → Goals

Task completion or progress updates linked Goal evidence, but the Match system and Feed do not own that relationship.

## Tasks → Match

Eligible task evidence contributes Match Points. Match settlement does not rewrite task records.

## Tasks → Chronicle

Session closure may offer contextual reflection. It does not auto-author personal meaning.

## Goals → Next Move

Review due, missing milestone, or missing next action may create a targeted Next Move candidate.

## Next Move → Subpages

Every candidate must route to one exact local subpage and focus target.

## Chronicle → Feed

Feed renders eligible Chronicle records. Editing once updates all projections.

## Profile Context → World and Match

The Profile is the authoring/control surface. World and Match render viewer-specific projections.

## Match → Profile and History

Match results update rating and history. They do not directly manage Goal structure.

## Achievements → All domains

Achievement processing consumes immutable or replay-safe events. It must not perform broad scans during ordinary writes.

## Themes → Every surface

Themes consume semantic tokens and feature recipes. Feature components may not hard-code one theme’s assumptions.

# 6.3 Duplicate-concept audit

Search for and reconcile duplicate or conflicting concepts:

- Feed post versus Chronicle Entry;
- journal versus Chronicle Entry;
- Goal review versus weekly review;
- current status versus Profile Context;
- task next action versus Plan Receipt next action;
- Match context versus Profile Context snapshot;
- achievement progress versus Contribution progress;
- Shop ownership versus Inventory ownership;
- theme selection in Settings versus profile-specific theme identity;
- World presence versus task-session status;
- active panel state versus local subpage state.

Each duplicate must be classified as:

```text
Same concept → consolidate
Projection → make read-only
Historical snapshot → preserve separately
Different concept → rename clearly
Obsolete concept → delete cleanly
```

---

# 7. Achievements v2

# 7.1 Central purpose

Achievements should answer:

> What meaningful patterns, turning points, skills, relationships, and chapters have become part of this profile’s history?

They should not answer:

> What arbitrary counter can the user inflate?

## Achievement constitution

1. An achievement must represent meaningful evidence.
2. It must not reward unsafe endurance, unhealthy deprivation, or fabricated task granularity.
3. It must not make social interaction feel transactional.
4. It must not create internal competition between 2v2 teammates.
5. It must not duplicate rank, Contribution, Coins, or Goal progress.
6. It must remain understandable after the event.
7. It must preserve the evidence and date that justified it.
8. Permanent achievements remain earned.
9. Temporary “currently #1” states belong to Records, not Achievements.
10. Achievements may unlock visual commemoration, but not productivity power.

# 7.2 Separate four concepts

```text
ACHIEVEMENTS
Permanent meaningful accomplishments.

RECORDS
Current or historical bests that may later be surpassed.

MILESTONES
Domain progress already represented elsewhere.

COLLECTIONS
Cosmetic ownership and theme sets.
```

Examples:

- “Reached Radiant” may be an achievement.
- “Currently #1” is a live record.
- “Completed 250 tasks” is a statistic or milestone, not necessarily a meaningful achievement.
- “Own every theme” is a collection record, not proof of mastery.

# 7.3 Existing achievements to retire or transform

## Retire

- **War Machine V — 100 consecutive wins**  
  Excessive and likely unattainable or distorting.

- **Total Immersion III — 8-hour session**  
  Rewards endurance rather than healthy, meaningful work.

- **Archive II — 10,000 words in one Feed post**  
  Encourages length rather than writing quality or relevance.

- **Distinguished Laureate II — 20 tasks in one day**  
  Encourages task fragmentation and quantity inflation.

- **Leader III — 70% of team score**  
  Makes a teammate’s lower contribution competitively useful to the player.

- **Town / friend-count tiers**  
  Turns relationships into collection targets.

- **Savant — top rank, top points, all cosmetics**  
  Combines unrelated systems and overweights ownership.

## Transform

- **Consistency**  
  Replace strict consecutive-day streaks with continuity and return.

- **Grinder / Scorer**  
  Move raw totals into Profile statistics or long-horizon Records.

- **Hobbyist**  
  Move cosmetic percentage into Collections.

- **King of the Hill**  
  Move “currently #1” to Records; preserve “once reached #1” as an achievement.

- **Peace / Dojo leaderboard**  
  Separate best-session record from meaningful practice achievements.

- **Legacy**  
  Replace word-count thresholds with Stories, Essays, and retrospective reflection.

- **Scholar**  
  Replace daily task counts with meaningful preparation or completion outcomes.

# 7.4 Proposed achievement categories

```text
Foundations
Continuity
Direction
Craft
Reflection
Community
Competition
Legacy
Discovery
```

# 7.5 Proposed achievement catalog

The exact names may be refined during visual design, but the triggering behavior is normative.

## Foundations

### First Movement

Earned when the profile records its first honest session outcome:

- Completed;
- Progressed;
- Blocked;
- or Stopped with preserved context.

Purpose: recognize beginning without forcing completion.

### Clear Next Step

Earned when a saved next action is later resumed and produces meaningful progress.

Higher stages:

- 1 successful continuation;
- 10;
- 50.

### Evidence Trail

Earned when work has durable evidence across several different activity types.

Stages:

- tasks and sessions;
- tasks, habits, and milestones;
- broad multi-domain history.

## Continuity

### Return Path

Earned when the user returns after a meaningful interruption and makes progress.

Stages may recognize:

- first successful return;
- 10 successful returns;
- sustained low median return time.

Do not expose or reward longer absences.

### Thread Keeper

Earned when the user repeatedly preserves next steps and resumes them later.

### Recovery

Earned after a blocked or stopped session is later resolved and progressed.

### Rhythm

Earned from intended-opportunity reliability over several review periods, not strict consecutive calendar days.

## Direction

### Wayfinder

Earned when a broad Goal is clarified into a finish condition, milestone, and executable next action.

### Course Correction

Earned when a Goal review produces a substantive and later useful revision:

- milestone changed;
- blocker resolved;
- obsolete direction removed;
- next action restored.

A review that changes nothing does not need to count.

### Milestone Maker

Stages:

- first completed milestone;
- 5 milestones;
- 20 milestones.

### Goal Finisher

Stages:

- first completed finite Goal;
- 3;
- 10.

A Goal must have completion evidence and a defined finish condition.

### Early Groundwork

Earned for meaningful progress on important work well before its deadline.

Use a bounded rule and do not reward false distant deadlines.

## Craft

### Focused Work

Recognizes completed or progressed sessions with trustworthy active time and a meaningful outcome.

Do not use an 8-hour threshold.

Possible stages:

- 45 minutes;
- 90 minutes;
- 3 hours with recorded breaks or session segmentation.

### Difficult Start

Earned when a repeatedly deferred or high-resistance task is started and meaningfully progressed.

The resistance evidence must predate the session.

### Long Work

Earned when one evolving task receives meaningful progress across several sessions and is eventually completed or formally resolved.

This recognizes real large tasks without demanding completion in one sitting.

### Unblocked

Stages:

- resolve first recorded blocker;
- 10;
- 50.

### Builder

Recognizes completing substantial project work whose evidence spans multiple tasks and a milestone.

## Reflection

### First Record

Earned for the first Chronicle Entry with actual authored content.

No reward currency.

### Story Arc

Stages:

- Story with 3 entries across at least 2 occurrence dates;
- 7 entries;
- completed Story with beginning and ending context.

### Essayist

Earned for a structured Essay that uses headings or deliberate long-form organization.

Do not use a raw word-count requirement.

### Looking Back

Earned for the first Write Back or Later Reflection linked to a historical moment.

### Carry Forward

Earned when a historical insight is carried into present action and later used.

### Context Keeper

Earned for connecting authored reflection to verified Daybook context without duplicating data.

## Community

Community achievements must be sparse and non-farmable.

### Witness

Earned once for leaving a meaningful semantic response connected to another profile’s context or Chronicle.

Do not create repeatable reaction-count tiers.

### Pair Bond

Stages:

- complete 3 Pair Matches with the same teammate;
- 10;
- 25.

### Balanced Pair

Earned when both teammates meaningfully contribute to a victory or strong performance.

Use a broad minimum contribution threshold, not an MVP award.

### Rally

Earned for a documented team recovery from behind without assigning a “carry.”

### Fellowship

Earned for meaningful shared work with several distinct Fellows over time.

Do not count friend creation alone.

## Competition

### First Rated Match

Earned when the first fixed-ruleset Pair Match settles successfully.

### Underdog

Preserve, but calculate from team expected outcome and fixed rating rules.

### Clutch

Preserve narrow-margin wins, with sensible thresholds based on actual score distributions.

### Comeback

Earned when a team moves from a meaningful deficit to victory.

### Rivalry

Earned when a mutual repeated series reaches a threshold and both profiles have opted into rivalry framing.

### Climber

Preserve permanent highest-rank achievements.

### Summit

Earned once for reaching the visible top neighborhood or #1. “Currently #1” remains a Record.

## Legacy

### Landmark

Earned when a major completed Goal creates a permanent World landmark.

### Era Keeper

Earned when an Era contains meaningful history, Chronicle context, and a clear transition.

### Living Archive

Earned from an interconnected body of Stories, milestones, and later reflections—not a raw item count.

### Shared History

Earned when repeated collaboration with another profile creates a durable shared historical trace.

## Discovery

Secret or low-pressure achievements may commemorate:

- first use of an unusual theme;
- finding a hidden but harmless interaction;
- revisiting a one-year-old chapter;
- using Write Back from a later Era;
- completing a task in every major life Area;
- returning to an old unfinished Story and closing it.

Discovery achievements must not block functional access.

# 7.6 Achievement rewards

Achievements may provide:

- profile badges;
- titles;
- cosmetic variants;
- World commemorations;
- Chronicle seals;
- optional reveal animations.

Achievements must not provide:

- task Points;
- Match score;
- Elo;
- general productivity multipliers;
- punishment for not pursuing them.

Coins should generally not be tied to achievements. If any achievement grants Coins, it must be a one-time, fixed, disclosed commemorative grant and must not create a farming loop.

# 7.7 Achievement interface

Create:

```text
Overview
Journeys
Records
Collections
Legacy Cabinet
```

## Overview

- recently earned;
- selected profile badges;
- nearby meaningful progress;
- no giant catalog wall.

## Journeys

- Foundations;
- Continuity;
- Direction;
- Craft;
- Reflection;
- Community;
- Competition;
- Legacy.

Show why progress matters, not only a bar.

## Records

- best rating;
- highest ladder position;
- best Match comeback;
- longest trustworthy focus session;
- strongest rhythm period;
- other factual records.

Records may change.

## Collections

- themes;
- titles;
- cosmetic sets;
- banners;
- ownership progress.

## Legacy Cabinet

Preserves retired achievements and their original earned dates.

They remain historical artifacts but are no longer active incentives.

# 7.8 Achievement v2 data model

```ts
type AchievementDefinitionV2 = {
  id: string;
  version: number;
  category: string;
  title: string;
  description: string;

  permanence: "permanent" | "record";
  visibility: "public" | "private" | "selectable";
  secret: boolean;

  evidenceRuleId: string;
  progressRuleId?: string;

  reward?: {
    titleId?: string;
    cosmeticId?: string;
    worldConsequenceType?: string;
    coinGrant?: number;
  };

  retiredAt?: string;
  replacementId?: string;
};
```

```ts
type AchievementEvidenceReceipt = {
  id: string;
  profileId: string;
  achievementId: string;
  achievementVersion: number;

  sourceEventIds: string[];
  evidenceSnapshot: Record<string, unknown>;

  earnedAt: string;
  processorVersion: number;
  migrationSource?: string;
};
```

The evidence snapshot must be enough to explain the award later.

# 7.9 Achievement migration

Add a new migration after the current migration series:

```text
036_achievement_system_v2.js
```

Process:

1. Back up the save.
2. Preserve every existing earned achievement and `earnedAt`.
3. Move retired achievements into Legacy Cabinet records.
4. Map directly equivalent achievements to v2 where authoritative evidence exists.
5. Rebuild candidate v2 achievements from event and domain evidence.
6. Do not infer awards when evidence is insufficient.
7. Preserve selected badges; if retired, render them as Legacy badges until replaced.
8. Recompute rarity from active v2 definitions separately from Legacy ownership.
9. Record migration provenance.
10. Run idempotency tests.

---

# 8. Theme-system overhaul

# 8.1 Current strength

The existing nine themes already define:

- color;
- light/dark mode;
- density;
- material;
- motion pack;
- sound pack;
- motif;
- typography;
- shape;
- global textures;
- structural overrides for shell and controls.

This must be preserved.

# 8.2 Current limitation

A theme can still feel like the same application with a different surface because many feature compositions remain identical.

A complete theme identity should influence:

```text
Color
Typography
Shape
Spacing and density
Surface material
Iconography
Illustration
Motion rhythm
Sound
Navigation treatment
Card composition
Empty states
Charts and progress visualization
World geography
Achievement presentation
Modal and drawer grammar
Microcopy tone
```

Microcopy must remain functionally clear and must not change data semantics.

# 8.3 Four-layer token architecture

## Layer 1: Primitive tokens

- raw colors;
- font stacks;
- spacing units;
- radius values;
- shadow values;
- motion timings;
- sound identifiers.

## Layer 2: Semantic tokens

- page background;
- surface;
- raised surface;
- interactive state;
- text hierarchy;
- success/warning/error;
- focus;
- task;
- Goal;
- Match;
- social;
- Chronicle.

## Layer 3: Component recipes

Each theme provides recipes for:

- navigation;
- page header;
- card;
- list row;
- tabs;
- local section nav;
- modal;
- drawer;
- input;
- progress;
- achievement badge;
- World landmark;
- Match scoreboard;
- Chronicle reader.

## Layer 4: Feature art direction

Feature-specific structures:

- Tasks;
- Goals;
- Profile;
- Chronicle;
- Match Arena;
- Shop;
- Settings;
- World.

The component markup should remain semantic and accessible. Art direction may use CSS, SVG, local image assets, and theme recipe props.

# 8.4 Theme contract

Extend `ThemeRegistry.js`:

```ts
type ThemeDefinition = {
  id: string;
  label: string;
  description: string;

  mode: "light" | "dark";
  density: string;
  material: string;
  motif: string;

  motionPack: string;
  soundPack: string;
  iconPack: string;
  illustrationPack: string;
  navigationRecipe: string;
  surfaceRecipe: string;
  typographyRecipe: string;
  worldRecipe: string;
  achievementRecipe: string;

  supportsReducedMotion: true;
  contrastProfile: "standard" | "high";
};
```

Create theme-specific recipe modules rather than an endlessly growing global CSS file:

```text
shared/styles/themes/
    minimalist/
    obsidian/
    old-windows/
    kawaii/
    gamification/
    pixelated/
    dreamcore/
    minimalist-light/
    mature-beige/
```

Each theme directory contains:

```text
tokens.css
components.css
features.css
motion.css
responsive.css
manifest.js
```

# 8.5 Deepening the existing themes

## Minimalist

Direction: Motion-like precision.

Required changes:

- restrained neutral surfaces;
- strong whitespace hierarchy;
- compact labeled navigation;
- near-flat cards;
- thin separators;
- low-amplitude motion;
- data-dense lists with excellent alignment;
- no decorative mascot or ornament;
- clean monochrome achievement seals.

## Obsidian

Direction: linked knowledge workspace.

Required changes:

- docked panes;
- tab strips;
- backlink and graph motifs;
- outlined hierarchy;
- note-like reading surfaces;
- split views for Profile History and Chronicle;
- active-line and linked-node states;
- keyboard-forward navigation;
- contextual side panes.

## Old Windows

Direction: complete retro desktop environment.

Required changes:

- title bars;
- menu bars;
- bevel hierarchy;
- classic dialog grammar;
- bitmap-style local icons created as SVG or CSS;
- window status bars;
- mechanical scrollbars;
- desktop-style settings tree;
- old-system achievement certificates.

Do not use inaccessible tiny text merely for authenticity.

## Kawaii

Direction: soft characterful companion interface.

Required changes:

- rounder composition, not only rounder corners;
- sticker-like badges;
- mascot reactions in empty states;
- soft section containers;
- friendly task and Goal characters where appropriate;
- buoyant but reduced-motion-safe transitions;
- softer charts;
- scrapbook-like Chronicle cards.

Avoid infantilizing serious content.

## Gamification

Direction: deliberate heroic RPG interface.

Required changes:

- quest-log Tasks;
- roadmap as campaign route;
- ornate achievement crests;
- Match Arena as tournament board;
- profile as character sheet;
- Contribution as legacy path;
- parchment or carved surfaces;
- stronger hierarchy between ordinary and legendary items.

Do not add app-native quests or maintenance chores.

## Pixelated

Direction: coherent low-resolution game UI.

Required changes:

- strict pixel grid;
- sprite-style icon set;
- stepped motion;
- bitmap borders and shadows;
- pixel map landmarks;
- inventory grids;
- compact achievement sprites;
- readable text fallback at accessibility scales.

Do not rasterize body text.

## Dreamcore

Direction: liminal autobiographical world.

Required changes:

- soft floating layouts;
- blurred depth layers;
- surreal environmental landmarks;
- Chronicle-first atmospheric visuals;
- slow route movement;
- translucent context capsules;
- dreamlike but legible hierarchy;
- subtle temporal distortion motifs for historical views.

Do not blur functional text or reduce contrast.

## Minimalist Light

Direction: calm professional daylight interface.

Required changes:

- large clean whitespace;
- thin neutral dividers;
- clear system typography;
- simplified icons;
- quiet dashboard summaries;
- nearly no decorative texture;
- high legibility in long-form and Settings;
- restrained focus and hover states.

## Mature Beige

Direction: editorial and archival.

Required changes:

- magazine-like column hierarchy;
- serif display typography with readable sans body where needed;
- paper and linen material;
- olive and ink accents;
- folio-style page numbers;
- Chronicle and Goal review as editorial spreads;
- understated achievement medallions;
- calm composed motion.

# 8.6 Proposed additional themes

Add only themes that create a new visual grammar.

## Solarpunk

Identity:

- warm daylight;
- botanical routes;
- organic panels;
- recycled-paper and glass materials;
- growth-ring progress;
- landscape-like World;
- living landmarks.

Best fit:

- Goals;
- habits;
- World;
- shared work.

Accessibility:

- avoid low-contrast pale green text;
- decoration must not obscure state.

## Frutiger Aero

Identity:

- sky, water, glass, and vivid natural color;
- glossy dimensional controls;
- bubble icons;
- optimistic early-2000s system design;
- spacious panels;
- animated environmental depth.

This is distinct from Old Windows because it represents later glossy consumer UI rather than beige desktop chrome.

## Blueprint

Identity:

- technical drawing grid;
- cyan, navy, white, or ink variants;
- measurement marks;
- annotation callouts;
- schematic Goals and dependencies;
- architectural World paths;
- stamped achievement marks.

This theme is especially appropriate for planning, engineering, and system-building.

## Editorial Noir

Identity:

- black, ivory, and one high-contrast accent;
- bold magazine typography;
- asymmetric layouts;
- photography or abstract image frames;
- strong section openers;
- cinematic Match recaps;
- serious Chronicle essays.

This is distinct from Mature Beige through contrast, editorial drama, and denser visual pacing.

## Theme addition policy

Additional future themes must pass this test:

> If all colors were temporarily converted to grayscale, would the theme still look and behave recognizably different?

If no, it is a palette variant, not a new theme.

# 8.7 Theme persistence and migration

Add:

```text
037_theme_recipe_architecture.js
```

Requirements:

- preserve existing theme IDs;
- backfill new recipe fields through registry defaults;
- preserve profile theme selection;
- do not reprice already owned themes;
- preserve old unlock receipts;
- new themes receive stable IDs;
- preview never writes until Apply;
- import/export includes theme ownership and selection;
- missing future themes fall back safely.

---

# 9. Persistence, migration, and historical-data integrity

# 9.1 Mandatory migration strategy

Use:

```text
Expand
→ Migrate
→ Verify
→ Switch reads
→ Contract
```

Never remove an old field before:

- all authoritative data has been copied;
- new reads are verified;
- old saves have fixtures;
- rollback has been considered.

# 9.2 Pre-migration backup

Before any migration that changes user-authored or progression data:

1. create a compact verified backup;
2. record schema version;
3. record source app version;
4. record a manifest checksum;
5. record record counts per domain;
6. store migration start and completion receipts.

If backup creation fails, the migration must not silently continue.

# 9.3 Integrity checks

At minimum, run:

```sql
PRAGMA integrity_check;
PRAGMA foreign_key_check;
```

Also verify:

- migration checksums;
- expected schema version;
- required indexes;
- unique constraints;
- orphaned Chronicle relations;
- orphaned Goal milestones;
- Match participant references;
- achievement receipt/event references;
- theme ownership references;
- active profile validity;
- resource-file availability;
- duplicate completion events;
- duplicate reward receipts.

# 9.4 Historical-data backfill

The revision must update old data where possible.

## Information architecture

No data duplication is required. Existing records should appear in the new subpages through routing and queries.

Preserve:

- filters where practical;
- active tabs through a compatibility map;
- current selected entity;
- profile replay state;
- open draft state.

## Achievements

- preserve old achievements in Legacy Cabinet;
- backfill v2 only from authoritative evidence;
- preserve earned dates;
- do not use today’s date for historic awards;
- do not award when original evidence is unavailable;
- record migration source.

## Themes

- preserve selected theme;
- preserve ownership;
- map existing IDs;
- add recipe defaults;
- no theme should revert to Minimalist unless its ID is invalid.

## Feed and Chronicle

- maintain canonical IDs;
- preserve Story order;
- preserve occurrence, written, and publication dates;
- preserve visibility;
- update obsolete response semantics through the retrospective-dialogue migration.

## Goals

- preserve Areas, finish conditions, milestones, next actions, status, check-in frequency, review dates, and Contribution evidence.

## Matches

- preserve historical ruleset metadata;
- new Matches use the current fixed Pair Match ruleset;
- old results must not be recalculated under new rules.

# 9.5 Derived data

Derived caches must be disposable and reconstructible.

After migration:

- rebuild Profile summaries;
- rebuild Social World projections;
- rebuild achievement counters;
- rebuild Chronicle context indexes;
- rebuild Goal overview projections;
- rebuild leaderboard views;
- rebuild theme preview caches;
- rebuild Next Move candidate state where appropriate.

The authoritative records must remain the source of truth.

# 9.6 Import/export round-trip

Create automated fixture tests:

```text
Old save fixture
→ import
→ migrate
→ export
→ re-import
→ compare authoritative data

Current save
→ export
→ delete local state
→ restore
→ compare

Large save
→ export
→ restore
→ verify resources and references
```

Comparison should allow regenerated cache differences but no authoritative-data loss.

# 9.7 Recovery behavior

On failure:

- stop write operations;
- preserve the original save;
- expose a clear recovery report;
- offer backup download;
- never create a new blank profile over failed existing data;
- never silently fall back to demo data;
- provide a retry after the defect is corrected.

---

# 10. Bug and quality-verification program

# 10.1 Installation preflight

The source archive does not contain `node_modules`, which is appropriate for packaging. Full validation requires:

```bash
npm ci
npm test
npm run build
npm run build:sqlite-runtime
```

A test failure caused solely by missing installed dependencies is an environment failure, not an application defect. Production acceptance requires running after a clean dependency install.

# 10.2 Test layers

## Unit

- domain logic;
- achievements;
- routing;
- migration functions;
- theme manifests;
- context projections;
- Next Move candidate rules.

## Repository

- CRUD;
- transactions;
- foreign keys;
- idempotency;
- receipts;
- query pagination;
- profile scoping.

## Integration

- Task → session → Goal evidence;
- Chronicle → Feed → Profile;
- Profile Context → World → Match snapshot;
- Match → rating → Profile;
- purchase → Inventory → theme apply;
- achievement event → receipt → profile badge;
- Goal review → Next Move → exact route.

## End-to-end

Add a browser automation suite, preferably Playwright.

Required journeys:

1. Create profile and task.
2. Plan, start, progress, and complete task.
3. Create Goal and milestone.
4. Complete work and verify Goal evidence.
5. Write Chronicle Moment, add to Story, verify Feed.
6. Create later reflection.
7. Queue and complete Pair Match.
8. Buy and equip a cosmetic.
9. Change each theme.
10. Export save, reset, and restore.
11. Upgrade an old fixture.
12. Navigate every new subpage through Next Move.

## Visual regression

Capture:

- every subpage;
- every major empty state;
- every major populated state;
- every theme;
- 75%, 100%, 125%, 150%, and 200% scale;
- narrow desktop;
- long content;
- overflow;
- reduced motion.

Visual snapshots are not sufficient by themselves. Review them manually and iterate.

## Accessibility

Test:

- keyboard-only operation;
- screen-reader landmarks and names;
- focus order;
- focus visibility;
- dialog behavior;
- reflow;
- text resize;
- non-text contrast;
- reduced motion;
- draggable alternatives;
- target size.

## Performance

Verify:

- startup read budgets;
- dynamic boundaries remain;
- hidden panels do not continue recurring work;
- subpages do not hydrate unrelated domains;
- large history tables paginate;
- theme CSS does not cause severe layout shift;
- World remains responsive with full cast.

# 10.3 Bug-search matrix

Explicitly search for:

- stale UI after cross-domain writes;
- data visible under the wrong profile;
- duplicate reward/achievement processing;
- lost drafts during navigation;
- broken back navigation;
- wrong subpage restored after profile switch;
- hidden panels running timers;
- theme-specific clipping;
- selected-theme mismatch after preview cancel;
- inaccessible contrast in new themes;
- imported records missing new fields;
- old achievements disappearing;
- historical Match rules overwritten;
- Chronicle entries duplicated across views;
- Goal review dates resetting;
- Next Move deep links opening the wrong object;
- SQLite worker race conditions;
- simultaneous writes producing partial state;
- resources missing after restore;
- archive entries appearing as active;
- record counts changing after round trip.

# 10.4 Data verification report

Add a user-accessible diagnostic under:

```text
Settings → Data & Backup → Verify Save
```

Report:

- schema version;
- last migration;
- integrity status;
- foreign-key status;
- authoritative record counts;
- orphan count;
- missing resource count;
- last backup;
- export readiness;
- caches requiring rebuild.

Do not expose internal stack traces by default. Provide an expandable technical report.

---

# 11. New migration and implementation map

Recommended migrations:

```text
036_achievement_system_v2.js
037_theme_recipe_architecture.js
038_navigation_preferences.js
039_retrospective_dialogue.js
```

The exact number may change if another migration lands first. Migration IDs must remain sequential and immutable after release.

Recommended source additions:

```text
shared/navigation/LocalSectionNav/
shared/navigation/LocalRouteService/

features/tasks/pages/*
features/goals/pages/*
features/profile/pages/subpages/*
features/matches/pages/*
features/events/pages/subpages/*
features/settings/pages/subpages/*
features/achievements/pages/*

domain/achievements-v2/
data/persistence/repositories/AchievementV2Repository.js
data/persistence/services/AchievementMigrationService.js
data/persistence/services/DataIntegrityService.js
data/persistence/services/SaveVerificationService.js

domain/themes/ThemeRecipeRegistry.js
shared/styles/themes/<theme-id>/*
```

Existing feature entrypoints should become shells that coordinate local routes rather than own all rendering and state.

---

# 12. Rollout sequence

## Phase 0 — Baseline and fixtures

- install dependencies cleanly;
- run current full tests and builds;
- create representative save fixtures;
- create screenshots for every existing theme;
- record baseline performance;
- back up source.

## Phase 1 — Local navigation architecture

- implement shared local nav;
- route intents;
- deep links;
- state preservation;
- panel lifecycle integration.

## Phase 2 — Low-risk page splits

- Settings;
- Achievements shell;
- Shop;
- Profile Identity.

## Phase 3 — Core page splits

- Profile;
- Match Arena;
- Events;
- Goals;
- Tasks.

## Phase 4 — Achievement v2

- catalog;
- receipts;
- migration;
- Legacy Cabinet;
- new interface;
- achievement visual language.

## Phase 5 — Theme recipes

- refactor existing themes into recipes;
- deepen every existing theme;
- add proposed new themes;
- run full visual regression.

## Phase 6 — Retrospective dialogue and cleanup

- replace obsolete response semantics;
- migrate data;
- remove dead message state.

## Phase 7 — Persistence validation

- integrity service;
- save verification;
- old-save fixtures;
- export/import round trips;
- recovery behavior.

## Phase 8 — Full-system polishing

- cross-feature audit;
- UI iteration;
- accessibility;
- performance;
- bug fixing;
- final clean build;
- package source.

The user receives one final implementation package, but the implementation must use these internal passes.

---

# 13. Acceptance criteria

The revision is complete only when:

## Information architecture

- every major feature has one dominant Overview;
- subpages correspond to distinct user questions;
- no feature exceeds two local navigation levels;
- navigation state restores correctly;
- Next Move deep-links to exact operations;
- no data is duplicated merely because a view moved.

## Achievements

- unhealthy or contradictory achievements are retired;
- old awards remain in Legacy Cabinet;
- v2 awards have evidence receipts;
- live records are separate from permanent achievements;
- achievements grant no productivity power;
- profile-selected achievements survive migration.

## Themes

- all existing themes are recognizably distinct in grayscale;
- every theme changes more than color;
- all themes cover every major subpage;
- all themes pass contrast and scaling tests;
- new themes use stable IDs and complete recipe manifests;
- preview is reversible.

## Data

- old saves migrate successfully;
- `PRAGMA integrity_check` passes;
- `PRAGMA foreign_key_check` returns no violations;
- export/import round trips preserve authoritative data;
- no blank-save fallback overwrites failed data;
- every migration is idempotent or safely guarded;
- derived caches rebuild.

## Quality

- clean install passes tests;
- production build passes;
- SQLite runtime build passes;
- end-to-end journeys pass;
- visual regression is reviewed for every theme and scale;
- accessibility checks pass;
- no known critical or high-severity bugs remain;
- major moderate defects are resolved or explicitly documented with justification.

---

# 14. Final autonomous implementation directive

This section is binding for the implementation model.

## 14.1 Preserve this specification in full

This plan must **never be contextually compressed, summarized away, or replaced by a shorter interpretation during implementation**.

The implementing model must repeatedly consult the complete specification. It must not rely on a remembered summary after work begins.

When context limits are encountered:

- store the full plan in the repository;
- reread the relevant complete sections before each implementation phase;
- maintain a requirements checklist mapping every normative requirement to code and tests;
- do not silently omit late sections.

## 14.2 Production-ready polish is mandatory

The output must be a production-ready, highly polished model—not a prototype, partial mockup, proof of concept, or rough first pass.

This includes:

- coherent architecture;
- finished copy;
- complete loading and empty states;
- error handling;
- accessibility;
- responsive behavior;
- every theme;
- animation quality;
- data integrity;
- performance;
- migration safety;
- visual consistency;
- no placeholder UI;
- no dead buttons;
- no temporary duplicate systems.

The standard is not “technically implemented.” The standard is “credible as a finished application.”

## 14.3 Delete removed features cleanly

When a feature, field, setting, branch, component, schema element, or concept is removed:

- remove its UI;
- remove state;
- remove service logic;
- remove repository behavior;
- remove analytics;
- remove tests that assert obsolete behavior;
- migrate or preserve historical data correctly;
- remove dead styles and copy;
- update documentation.

Do not merely hide obsolete behavior behind CSS or flags unless a documented migration window requires temporary compatibility.

## 14.4 Implement the complete scope in one delivery

Implement **everything in this specification in one final delivery**.

Internally, treat the work as many disciplined prompts and phases:

- architecture;
- migrations;
- domain logic;
- UI;
- themes;
- tests;
- visual review;
- bug fixing;
- packaging.

Do not reduce quality because the user requested one delivery. “One go” describes the final handoff, not a literal unreviewed coding pass.

No scope compromise is permitted merely because the revision is large.

## 14.5 Resolve ambiguity autonomously

For details that remain ambiguous:

1. inspect the existing source and data model;
2. preserve Charcoal’s established philosophy;
3. use the research-backed principles in this document;
4. choose the most coherent production behavior;
5. document the decision;
6. implement it fully.

Do not stop and leave obvious gaps simply because every pixel or threshold was not prescribed.

## 14.6 Test visually and iterate without an arbitrary pass limit

The implementation must be repeatedly opened and visually inspected.

For every major surface:

- render realistic populated data;
- render empty states;
- render long content;
- render every theme;
- test all specified scales;
- test narrow windows;
- test interaction states;
- compare hierarchy, spacing, clipping, contrast, and motion;
- revise based on observed results;
- rerun tests.

There is no fixed maximum number of visual revision passes. Continue until the interface is coherent and polished.

Automated tests do not replace visual inspection. Visual inspection does not replace automated tests.

## 14.7 Verify data before declaring completion

Before completion:

- create a backup;
- migrate old fixtures;
- run integrity checks;
- verify foreign keys;
- export and re-import;
- compare authoritative data;
- rebuild caches;
- verify profile, task, Goal, Match, Chronicle, achievement, Shop, and theme data;
- test interrupted migration and recovery.

Do not claim success if only a fresh empty database works.

## 14.8 Package and produce the output

When finished:

1. create a clean production source archive;
2. exclude `node_modules`, build output, temporary screenshots, caches, and unrelated generated files;
3. include source, migrations, tests, package files, documentation, and required local assets;
4. produce the built output if the project’s delivery process requires it;
5. include a migration and test report;
6. include a concise implementation summary;
7. provide the resulting archive to the user.

The source archive must be independently installable and buildable with documented commands.

## 14.9 No false completion

Do not mark the work complete while any of the following remain:

- unimplemented normative sections;
- placeholder screens;
- old duplicate systems;
- failing required tests;
- broken themes;
- known data loss;
- missing migration support;
- visual overflow;
- inaccessible controls;
- unverified export;
- unpackaged source.

If something genuinely cannot be completed, state it explicitly and identify the exact unresolved requirement. Do not conceal it behind confident language.

---

# 15. Final product statement

The intended result is not a smaller Charcoal.

It is a Charcoal whose size has become legible:

> **The World remains expansive.  
> Each destination becomes focused.  
> Achievements preserve meaningful history.  
> Themes become distinct identities.  
> Data remains trustworthy across every revision.  
> Next Move makes the expanded structure navigable.**

The application should feel rich without feeling cramped, immersive without becoming disorienting, and highly customized without becoming architecturally inconsistent.
