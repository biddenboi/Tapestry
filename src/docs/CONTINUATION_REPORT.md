# Continuation report — schema 39 stabilization

Date: 2026-07-28

## Handoff reconstructed

The supplied source already contained the schema-36 through schema-39 work,
focused destination shells, achievements v2, thirteen theme recipe definitions,
navigation preferences, retrospective dialogue, and save verification. The
older implementation note described only schema 30, so the source and tests
were treated as the authoritative handoff.

## Repaired in this continuation

- Fresh demo SQLite databases now synchronize all thirteen theme recipe
  manifests after reset. Previously the runtime registry existed but the new
  demo database left `theme_recipe_manifests` empty.
- Migration 034 and 035 tests now apply only migrations that precede their
  target migration. They had begun applying schema-36 through schema-39 first,
  which produced an invalid synthetic migration order.
- Feed, Profile, Social World, Goals, and Daybook wiring contracts now use the
  schema-39 local-page identifiers (`recent`, `wander`, `history`, `identity`)
  and current schema version.
- The canonical test command is serialized. SQLite WASM and Vite integration
  fixtures contend under Node's file-level parallel runner; serialization runs
  the complete suite deterministically and exits cleanly.

## Verification

- `npm ci`: passed
- `npm test`: 789 passed, 0 failed
- `npm run build`: passed
- `npm run build:sqlite-runtime`: passed
- Focused regression suite for demo projection, migrations 034/035, Feed,
  Chronicle, Profile visibility, Social World residency, Goals wiring, and
  Daybook wiring: passed
- Desktop browser smoke: Social World rendered with populated demo state;
  Profile exposed Overview, Context, History, Competition, and Identity;
  History rendered Daybook chapters; Tasks exposed Now, Queue, All Tasks,
  Planning, and History; Queue selection survived close/reopen; browser console
  contained no warnings or errors.

## Known non-blocking observations

- Vite reports that a few dynamically imported modules are also statically
  imported, so those modules remain in their existing chunks.
- Vite reports a main JavaScript chunk above 500 kB. Both production builds
  complete successfully; further bundle splitting is a separate performance
  optimization.
- The in-app browser viewport controller stalled during a fresh 390 x 844 check.
  Existing responsive source tests remain green, but this continuation does not
  claim a new mobile visual pass.
- `npm ci` reports three high-severity dependency advisories. No automatic
  dependency upgrade was applied because `npm audit fix --force` could introduce
  breaking changes; dependency remediation should be handled as a dedicated
  upgrade with its own regression pass.

## Packaging

The delivery archive excludes `node_modules`, `dist`, `.DS_Store`, `__MACOSX`,
coverage output, caches, and screenshots. The normative specification remains
unchanged in `docs/CHARCOAL_INFORMATION_ARCHITECTURE_ACHIEVEMENTS_THEMES_DATA_STABILIZATION_SPEC.md`.
