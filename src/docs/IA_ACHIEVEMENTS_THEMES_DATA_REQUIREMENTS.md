# IA, Achievements, Themes, and Data implementation checklist

Normative source: `CHARCOAL_INFORMATION_ARCHITECTURE_ACHIEVEMENTS_THEMES_DATA_STABILIZATION_SPEC.md`

This file is the implementation-to-verification map. A checked item requires code, tests, and visual review where applicable.

## Baseline and architecture

- [ ] Clean baseline test, production build, and SQLite runtime build recorded.
- [ ] Shared `LocalSectionNav`, route outlet, route state, and route service.
- [ ] Keyboard navigation, selected state, compact mode, responsive collapse, landmarks, and focus.
- [ ] Local route persistence is profile/panel scoped and compatibility-mapped.
- [ ] Expensive subpages remain mounted unless disposed through panel lifecycle.
- [ ] Next Move targets exact local page and entity/focus operation.

## Focused destination shells

- [ ] Tasks: Now, Queue, All Tasks, Planning, History.
- [ ] Goals collection: Overview, Areas, Reviews, Completed.
- [ ] Goal detail: Overview, Roadmap, Activity, People, Review & Settings.
- [ ] Profile: Overview, Context, History, Competition, Identity.
- [ ] Match Arena: Arena, Current Match, Standings, History.
- [ ] Events: Calendar, Habits & Rhythms, Day Boundaries, Review Schedule.
- [ ] Feed: Recent, Wander, Stories, Essays over canonical Chronicle entries.
- [ ] Chronicle: Latest, Stories, Essays, Revisit, Archive over canonical Chronicle entries.
- [ ] Shop: Featured, Browse, Collections, History.
- [ ] Inventory: Equipped, Collection, Themes, Banners & Identity.
- [ ] Settings: General, Appearance & Themes, Notifications, Privacy & Social, Accessibility, Data & Backup, Advanced.
- [ ] Achievements: Overview, Journeys, Records, Collections, Legacy Cabinet.
- [ ] Major overviews contain current state, one primary action, at most three attention items, and concise deep links.
- [ ] No user-facing Match ruleset configuration remains.
- [ ] Goal `Review` setting is labeled `Check-in frequency`.

## Canonical ownership and handoffs

- [ ] Subpages are read/write projections over canonical records, not duplicate stores.
- [ ] Task → Goal evidence remains Goal-owned.
- [ ] Task → Match points does not rewrite task records.
- [ ] Task → Chronicle reflection remains opt-in and does not auto-author meaning.
- [ ] Goal → Next Move creates exact review/milestone/next-action routes.
- [ ] Chronicle → Feed/Profile remains a single editable record.
- [ ] Profile Context → World/Match uses viewer-specific projections.
- [ ] Match → rating/history does not own Goal structure.
- [ ] Achievement processing is event/receipt driven and replay safe.
- [ ] Shop ownership and Inventory equip state remain canonical.
- [ ] Theme selection and profile theme identity use one canonical field.

## Achievements v2

- [ ] Active catalog excludes unsafe endurance, task-volume, friend-count, teammate-carry, total-cosmetic, and extreme streak incentives.
- [ ] Definitions separate permanent Achievements, mutable Records, domain Milestones, and cosmetic Collections.
- [ ] Foundations, Continuity, Direction, Craft, Reflection, Community, Competition, Legacy, and Discovery rules implemented.
- [ ] Achievement evidence receipts preserve source event IDs, snapshot, earned date, processor version, and migration provenance.
- [ ] Achievement rewards grant no task points, match score, Elo, or productivity multipliers.
- [ ] Retired awards and original dates render in Legacy Cabinet.
- [ ] Selected retired badges remain renderable as Legacy badges.
- [ ] Migration `036_achievement_system_v2.js` is guarded and idempotent.
- [ ] Candidate v2 backfill only awards from authoritative evidence.
- [ ] Active rarity excludes Legacy ownership.

## Theme recipes

- [ ] Registry exposes icon, illustration, navigation, surface, typography, world, achievement, reduced-motion, and contrast recipe fields.
- [ ] Primitive, semantic, component-recipe, and feature-art-direction layers are present.
- [ ] Existing themes retain stable IDs and ownership.
- [ ] Minimalist, Obsidian, Old Windows, Kawaii, Gamification, Pixelated, Dreamcore, Minimalist Light, and Mature Beige each have complete manifests and recipe styles.
- [ ] Solarpunk, Frutiger Aero, Blueprint, and Editorial Noir use stable IDs and complete manifests.
- [ ] Every theme changes component grammar beyond color and remains accessible at scale.
- [ ] Preview never persists until Apply; cancel restores the selected theme.
- [ ] Migration `037_theme_recipe_architecture.js` backfills recipe defaults without repricing or losing receipts.
- [ ] Import/export preserves theme ownership and selection with safe missing-theme fallback.

## Navigation and retrospective migrations

- [ ] Migration `038_navigation_preferences.js` maps old tabs and preserves selected entity, scroll/filter state where practical, and profile scope.
- [ ] Migration `039_retrospective_dialogue.js` replaces obsolete response semantics.
- [ ] History actions are Write Back, Add Later Reflection, Carry Forward, and What Happened Afterward.
- [ ] Canonical Chronicle IDs, Story order, occurrence/written/publication dates, visibility, and addenda relations survive migration.

## Data integrity and recovery

- [ ] Pre-migration compact backup includes schema/app versions, checksum, domain counts, and start/completion receipts.
- [ ] Backup failure blocks migration.
- [ ] `PRAGMA integrity_check` and `PRAGMA foreign_key_check` are included.
- [ ] Verification covers checksums, schema/indexes/constraints, orphans, active profile, resources, duplicate completions/rewards, and theme references.
- [ ] Settings → Data & Backup → Verify Save exposes plain-language and expandable technical reports.
- [ ] Derived caches are rebuildable from authoritative records.
- [ ] Old, current, and large-save import/export round-trip fixtures preserve authoritative data.
- [ ] Failure preserves original data, blocks writes, offers backup, reports recovery, and never silently creates demo/blank data.
- [ ] Advanced exposes checkpoint, diagnostics, cache rebuild, achievement reconciliation, migration report, and confirmed destructive reset.

## Quality gates

- [ ] Unit, repository, integration, migration, idempotency, and route tests pass.
- [ ] Browser journeys cover tasks, Goals, Chronicle/Story/reflection, Pair Match, cosmetics/themes, backup/restore, old-save upgrade, and Next Move deep links.
- [ ] Major populated and empty subpages reviewed in every theme.
- [ ] 75%, 100%, 125%, 150%, 200%, narrow desktop, overflow, and reduced-motion states reviewed.
- [ ] Keyboard, focus, landmarks, dialog behavior, target size, contrast, reflow, and draggable alternatives reviewed.
- [ ] Startup/read budgets, hidden-panel timers, pagination, layout shift, and full-cast World responsiveness reviewed.
- [ ] Clean `npm ci`, `npm test`, `npm run build`, and `npm run build:sqlite-runtime` pass.
- [ ] Source archive excludes dependencies, build output, screenshots, caches, and unrelated generated files.
- [ ] Migration/test report and concise implementation summary are packaged.
