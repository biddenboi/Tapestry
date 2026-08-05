# Tapestry

Tapestry is a local-first life-sim and productivity game. It tracks tasks, journal entries, matches, events, rewards, profiles, reminders, and social activity in a durable SQLite workspace. The cloud is the cross-device convergence authority; device-local storage is the offline working copy and mutation outbox, never an independent fork of the account.

## Tech Stack

- React 19 with Vite
- Electron packaging for desktop builds
- SQLite WASM with a persistent desktop backup and a bounded mobile working set
- Supabase operation/reference synchronization and Cloudflare Pages hosting
- JSZip for save snapshots and import/export bundles
- Leaflet with OpenStreetMap tiles for the map-first shell
- Node test runner for domain and persistence regression tests

## Setup

1. Install dependencies:

       npm install

2. Start the Vite dev server:

       npm run dev

3. Build the web bundle:

       npm run build

4. Run regression tests:

       node --test src/**/*.test.mjs

5. Start Electron in development when needed:

       npm run electron:dev

## Production PWA

The mobile companion is deployed to `https://tapestry-mobile.pages.dev` with
Cloudflare Access restricted to the approved owner email. Cloudflare Pages
preview protection must also remain enabled so random deployment URLs are not
public.

Build and deploy the same tested bundle with:

    npm run build
    npx wrangler pages deploy dist --project-name tapestry-mobile

The build environment needs the publishable Supabase URL/anonymous key and the
public Web Push key. Supabase service-role credentials, the private VAPID key,
and the push scheduler secret are server-only and must never enter the Pages
bundle. See `supabase/README.md` for migration, Edge Function, Vault, and cron
setup.

## Project Layout

The app now uses feature-owned modules and path aliases:

- @app maps to src/app and owns the app shell, context, data gate, notifications, and panel host.
- @data maps to src/data and owns DatabaseConnection plus save-bundle and linked-folder persistence helpers.
- @domain maps to src/domain and owns pure business rules such as time, ranks, tasks, matches, feed state, shop ranking, events, achievements, and profile modeling.
- @features maps to src/features and owns screens, feature modals, local components, and feature public exports.
- @shared maps to src/shared and owns reusable UI, icons, hooks, media/resource helpers, markdown helpers, browser-neutral utilities, and global styles.

Feature code should prefer app context for data access. Domain code should stay browser-neutral where possible. Data code should expose narrowly named utilities instead of leaking save internals into screens.

## Data Model

Desktop keeps the complete SQLite workspace locally so every feature works offline. Local changes are committed atomically and recorded separately in durable operation/reference outboxes; reconnecting uploads only those changes, then downloads newer cloud changes. Periodic verified SQLite checkpoints are desktop recovery backups, not the normal synchronization payload.

Mobile restores only the mobile-safe working set and referenced resources. It can continue an already-cached session offline, but a cleared/new phone needs the cloud to reconstruct that cache. Match and task-session coordination synchronize immediately, ordinary planning, Event-definition, and commerce edits use a short buffer, and journal, Event-completion, stat, and comment changes use the background lane. Desktop-trained Task Recommender v12 model artifacts are the only app-settings records distributed to mobile.

## Common Workflows

- Add a screen: create or extend src/features/<feature>/, export the public screen loader or helper from src/features/<feature>/index.js, then register it in the app shell.
- Add a rule: place pure functions under src/domain/<area>/ and import them from features through @domain.
- Add map behavior: keep projection, distance, interpolation, and location normalization in src/domain/map; keep Leaflet rendering in src/features/world-map.
- Add persistence: update src/data/db/saveBundleFormat.js and src/data/db/saveBundleUtils.js, then add or update a Node regression test.
- Add shared UI: place browser-neutral components in src/shared/ui and export them from src/shared/ui/index.js.
- Add docs: update docs/ARCHITECTURE.md, docs/FEATURE_GUIDE.md, docs/PERSISTENCE.md, or docs/APP_SUMMARY.md when a change alters boundaries or app behavior.

See docs/ARCHITECTURE.md for module responsibilities, docs/FEATURE_GUIDE.md for extension steps, docs/PERSISTENCE.md for the save contract, and docs/APP_SUMMARY.md for the current product map.
