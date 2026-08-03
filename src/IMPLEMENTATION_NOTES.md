# Charcoal IA, Achievements, Themes, and Data Stabilization

This build continues the Goals System baseline through schema version 39 and
implements the production restructuring specified in
`docs/CHARCOAL_INFORMATION_ARCHITECTURE_ACHIEVEMENTS_THEMES_DATA_STABILIZATION_SPEC.md`.

## Included

- Focused local-page navigation for Tasks, Goals, Profile, Match Arena, Events,
  Feed, Chronicle, Shop, Inventory, Settings, and Achievements
- Profile- and panel-scoped route persistence with compatibility mappings and
  exact Next Move destinations
- Achievements v2 definitions, evidence receipts, records, Legacy Cabinet,
  replay-safe processing, and schema-36 migration
- Thirteen complete theme recipe manifests, including Solarpunk, Frutiger Aero,
  Blueprint, and Editorial Noir, with schema-37 persistence
- Navigation preference and retrospective-dialogue migrations through schema 39
- Save verification, integrity reporting, guarded pre-migration backup, and
  compact-import recovery infrastructure
- Demo coverage for the restructured pages, achievements v2, Legacy awards, and
  every theme recipe; fresh demo databases now synchronize theme manifests
- Serialized test execution so SQLite/Vite integration tests run deterministically

## Verification

- `npm test`: 789 tests passed
- `npm run build:sqlite-runtime`: passed
- `npm run build`: passed
- Desktop browser smoke QA passed for the Social World, Profile Overview and
  History, Tasks Now and Queue, route persistence after panel reopen, demo theme
  manifest initialization, and clean browser console output.
- A fresh responsive viewport pass was attempted but the browser viewport
  controller stalled; no new mobile claim is made in this continuation batch.

See `docs/CONTINUATION_REPORT.md` for the repaired regressions, gate results,
known build warnings, and packaging notes.

## Run

```sh
npm install
npm run dev
```

For the production bundle:

```sh
npm run build
npm run preview
```
