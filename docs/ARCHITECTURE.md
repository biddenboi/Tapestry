# Architecture

Tapestry is a local-first React app organized around five top-level module groups: app, data, domain, features, and shared. The goal is to keep product surfaces easy to modify while keeping game rules and persistence rules testable outside React.

## App Shell

src/app owns startup and coordination. App.jsx creates DatabaseConnection, exposes AppContext, tracks the active player, current game state, active match, active task, active panel, notifications, toasts, and data source readiness. DataSourceGate opens the complete persistent desktop SQLite workspace and can restore its verified cloud checkpoint. MobileCloudBootstrapGate authenticates a clean phone and reconstructs only the mobile-safe working set from cloud references; it never downloads the desktop checkpoint. NotificationCenter renders transient and persisted notifications. GameHub owns the main shell, floating map controls, map-first base layer, overlay panel routing, wake/sleep checks, persistent reminder toasts, profile switching, quick notes, inbox access, background task nudges, and lazy loading of feature panels.

The app shell should not know the private component layout of a feature. It should import public screen loader functions and public helpers from src/features/<feature>/index.js.

MobileAppShell is the parallel presentation coordinator for companion mode. It composes dedicated mobile feature pages, while MobileSurfaceContext and MobileOverlayHost own transient navigation, dismissal guards, focus restoration, feedback, and the shell FAB. Mobile UI may coordinate queries and commands but must not reproduce persistence, reward, ownership, commerce, Match, or recurrence rules.

## Feature Modules

src/features owns user-facing product areas. A feature may contain components, modals, model, services, styles, and an index.js public export. Screens and modals can compose domain functions, shared UI, and app context. Cross-feature imports should go through the other feature's index.js so folder layout can change without rippling through the app.

Current features include lobby, matches, tasks, profile, feed, shop, inventory, events, contribution-pass, settings, reminders, inbox, quick-notes, and achievements.

## Domain Modules

src/domain owns business rules and derived models. Domain functions should avoid React and direct browser APIs. Important areas are:

- time: real time, in-game time, formatting, local day boundaries.
- rank: ELO, ranks, rank gates, dojo unlocks, match duration rules.
- tasks and planning: task duration, slope and work-per-day calculations, task drafts, planning recommendations.
- matches: matchmaking, ghost roster generation, replay traces, ELO changes, scoring state, highlights.
- feed: hidden activity state capture, post ranking, journal tags, image normalization.
- shop: reward item models, inventory use rules, cooldowns, recommendation ranking.
- events: wake/sleep, workday transitions, dojo contribution, habit events, event logs.
- achievements: achievement catalog and checking/progress logic.
- profile: biography, derived stats, personalization, insight panels, friendship-adjacent summaries.
- contribution: overall reputation, goal-scoped contribution, contribution pass rewards, goal checks, manual reports, and unlock state.
- rewards: deterministic bounded surprise rewards for tasks and lightweight actions, including coin reels, contribution values, and hotspot coin bonuses.
- map: location normalization, Web Mercator projection, distance sorting, softened marker positions, IGT timeline interpolation hooks, task gyms, and hidden hotspots.

Domain tests live next to domain modules as .test.mjs files and use Node's built-in test runner.

Task draft mutation is shared through TaskDraftCommand, and mobile pair matchmaking is shared through MatchmakingCommand. Both carry explicit origin/operation metadata so desktop and mobile presentation cannot develop competing write semantics. Once work starts, ActionSession is the durable attribution boundary: settlement resolves its pinned player and activity context, while ActionSessionSync replays the complete canonical evidence set under the original idempotent operation ID.

## Data Layer

src/data owns persistence and folder synchronization. DatabaseConnection is the app-facing gateway for CRUD, player-scoped reads, IGT projection, linked-folder sync, zip import/export, resources, economy state, notifications, reminders, friendships, bans, and compatibility helpers. The db folder owns save-bundle format constants, journal Markdown parsing/formatting, linked-folder handle caching, source-handle utilities, economy serialization, and persistence tests.

Planning definitions use workspace visibility. Projects/Goals, Todos, reminders, Goal areas, milestones, and links belong to the default workspace and retain their legacy player owner only for compatibility and creator provenance. Completed tasks, Goal updates, rewards, inventory, economy, cosmetics, and competitive state remain profile-attributed. Mobile reads planning through application query adapters and sends mutations through the existing domain commands; changing the active profile does not change the planning result set.

Feature code should not construct DatabaseConnection. It should use useAppContext and call the already-created connection from the app shell.

## Shared Layer

src/shared contains reusable UI and browser-neutral helpers: base UI components, overlay focus helpers, icons, profile pictures, resource images, post image picker/gallery, markdown editor, ELO chart, timer, useInterval, media compression, resource references, NLP parsing, browser location helpers, lightweight last-known location cache helpers, and global styles.

ProfileIdentity is the canonical identity renderer for avatar, title, frame, theme metadata, and rank presentation. Mobile identity surfaces pass profile records through this renderer so desktop-equipped cosmetics appear read-only without exposing mobile equip controls.

Shared code should not import feature-private files. It may import domain constants or app context only when the component is explicitly app-aware, such as ResourceImage or post image helpers that need the active database connection.

## Persistence Flow

SQLite is the durable local working copy on both surfaces. Desktop retains the complete database and therefore opens fully offline. Mobile retains a bounded mobile-safe cache: an existing session can continue offline, while a cleared or new installation requires a cloud restore. Every local mutation commits atomically with a separate durable outbox row. Normal sync uploads only queued mutations/references and pulls newer cloud rows; it does not transfer the whole database.

Synchronization has three urgency lanes. Match state, scores, task completions, and Action Sessions use the live lane without a debounce. Task/Goal/reminder/profile/shop and Event-definition edits use a 750 ms prompt lane. Journals, comments, Event completions, contributions, stats, and other historical facts use the background lane. Supabase realtime nudges and a 1.5 second live-state reconciliation keep concurrent Match and task-session state close across devices.

Desktop periodically publishes a verified full SQLite checkpoint as a recovery backup. Mobile checkpoint upload and download are disabled. Desktop-trained Task Recommender v12 model records are prefix-filtered into the mobile mirror so mobile can run the model without receiving unrelated desktop settings or training state.

## IGT Projection

In-game time is calculated from profile history and used as a boundary for simulation. Reads that need historical consistency should prefer IGT-bound data access, such as getPlayerStoreThroughIGT and getCompletedMatchesThroughIGT. Match ghost simulation uses the viewer's match-start IGT so another profile's future history cannot leak into the current match.

## Match Simulation

Matches build a roster from active and simulated profiles. For ghost players, the primary path replays one of the player's completed historical match traces visible at the viewer IGT, scales it to the new duration, and derives expected output. If no trace exists, the fallback estimates from ELO and task history through the same IGT boundary. Live scoring uses task sessions, highlights, rank/ELO updates, achievements, and match result records.

## Map Layer

The default shell is map-first. src/features/world-map owns the Leaflet/OpenStreetMap rendering layer, active/nearby profile markers, derived gym and hotspot markers, tile failure handling, offline-safe fallback background, app-level viewport persistence, and browser-location refresh cadence. It uses the last known browser location immediately when available, then refreshes geolocation at roughly five-minute intervals. src/domain/map owns browser-neutral geometry, located-action timeline extraction from tasks/journals/events/matches, IGT interpolation, nearest-profile selection, deterministic softening, derived task-gym clustering, and repeated-location hotspot derivation so movement, gyms, and hotspot bonuses can be tested without React or Leaflet.

## Feed And Shop Recommendation Model

FeedState captures hidden activity signals from recent tasks, todos, journals, wins, and timing. Ranking compares the viewer's current activity state with the creation state stored on posts. The shop consumes the same activity model to vary item ordering, category emphasis, duration preferences, enjoyment bias, and recommendation reasons, making the shop feel closer to a game menu instead of a static catalog.


## Attention And Reward Loop

The app uses bounded, auditable surprise rewards rather than dark-pattern probability tuning. src/domain/rewards owns deterministic reward rolls so the same action seed produces the same bonus result. Task completion keeps point scoring intact, then adds bonus coins, contribution value, and an animated post-session coin reel. Hotspots can add hidden coin bonuses and match-only point multipliers when the player completes work inside a derived repeated-location zone.

GameHub also schedules background task nudges only when the app is unfocused, idle, and not in a task or match. The nudge selects from the planning recommendation model with light randomness and opens the task preview with a 10-minute commitment.
