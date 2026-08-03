# App Summary

This document summarizes the current Tapestry app so future developers and AI agents can make changes without rediscovering the whole product.

## App Shell

The app starts through src/main.jsx and src/app/App.jsx. App.jsx creates a single DatabaseConnection, wraps the tree in AppContext and NiceModal, tracks active player state, game state, active task, active match, active panel, viewing profile, notifications, toasts, timestamps, data revision, data source readiness, and dojo session UUID.

On companion devices, MobileAppShell replaces the desktop composition with dedicated Today, Goals, Chronicle, Shop, and More tabs. The mobile shell owns cached tab state, route/back handling, the global FAB, dialogs, feedback, focus restoration, safe-area and visual-keyboard behavior. It shares domain commands, repositories, identity rendering, persistence, and sync with desktop without embedding desktop feature pages.

DataSourceGate blocks the main app until the linked folder is available. If folder access is missing or .tapestry disappears, the app resets readiness and returns to the folder screen. GameHub renders the primary shell: the world map base layer, floating edge controls, overlay panels, lobby command menu, inbox access, quick notes, wake/sleep handling, end-of-day checks, persistent reminder toasts, profile switching, unfocused-app task nudges, and lazy feature screens.

Important game states include idle, active task/session, match, and dojo. The idle state now opens on the map. Lobby is a floating command menu, while tasks, events, feed, inventory, profile, shop through inventory, contribution pass through inventory, settings through profile, inbox, quick notes, and modal-driven surfaces overlay the map.

## Map

The world map is the default base layer. It uses Leaflet with OpenStreetMap tiles when online and a non-breaking vector fallback when tiles are unavailable or the browser is offline. The active profile marker resolves from the latest located action at the current IGT, then the cached last-known browser location, then a fresh browser geolocation ping, then a regional fallback. Nearby profile markers are selected by interpolating each profile location at the viewer IGT, prefiltering by projected distance, and final-sorting by haversine distance. Task gyms are derived from clusters of completed located tasks and rendered as non-canonical map markers. Repeated located task completions can also derive hidden hotspots; when a player completes work inside a hotspot, the reward reveal can include extra coins and match-only point multipliers. Browser geolocation is refreshed at roughly five-minute intervals rather than constantly. Map viewport state is stored in app settings, not on the profile record.

## Profiles

Profiles are the main identities in the simulation. Each profile has identity fields, timestamps, ELO, rank, tokens and money-adjacent state, biography text, active cosmetics, banner/image resources, relationships, achievements, match history, journal history, task history, event history, and derived stats.

In-game time progression is profile-aware. Current IGT is used to decide what history is visible to another simulated profile. This matters most for match ghosts: if the viewer's IGT is halfway through another profile's history, that profile should perform like they did at that point, not like their newest saved state.

Profile surfaces include biography, match and task history, journal history, ELO chart, rank progress, achievements, friendship-related information, profile insight panels, personalization settings, cosmetics, and ban/profile-deletion flows.

## Tasks And Todos

Tasks represent work sessions and completed output. Todos represent planned or pending work. The task domain calculates duration, points, tokens, work-per-day, slopes, aversion/coercion values, due windows, planning suggestions, and display view models.

Task screens support creation, preview, session execution, completion, notes, reminders, and session results. The map shell also has a compact task tray: a simple checklist of ready tasks where the circular checkbox completes a task and clicking the row opens the full task editor focused on that task. When the app is unfocused and idle, GameHub can show a persistent 10-minute task nudge selected from the planning model with light randomness. Completed tasks feed into profile progression, match scoring, event/habit streaks, overall reputation, goal-scoped contribution, feed/shop activity signals, achievements, IGT projection, and a bounded coin-reel reward reveal.

Planning helpers connect lobby recommendations, today's plan cards, task drafts, and task preview/session flows.

Task estimates accept every positive whole-minute value rather than a preset interval. Once a task session begins, its durable Action Session pins the attributed profile and Match/Dojo context. Completion and remote replay resolve that evidence instead of trusting the currently selected UI profile, reject mismatched targets, and apply the canonical settlement records idempotently.

## Matches

Matches are the original game loop. The lobby can start matchmaking, produce teams, and enter MatchArena. Live scoring comes from task work completed during the match. Results write match records, ELO changes, highlights, achievements, and profile progression.

Ghost simulation uses historical player traces. The primary path replays completed match traces visible at match-start IGT and scales their task sessions to the current match duration. The fallback estimates power from ELO and task history, also bounded by viewer IGT. This prevents future profile data from leaking into earlier simulations.

Match surfaces include MatchArena, PracticeDojo, match details, insufficient-player handling, live event feed, status panel, activity badges, rank-up modal, achievement badges, and profile history integration.

## Dojo And Events

Events model daily rhythm and habit/game rituals: wake, end work, sleep, habits, dojo sessions, entertainment checks, ritual buffs, day-boundary state, event logs, and goal contribution spaces. In the map shell, Events behaves as a compact sidebar; creation and edit flows appear as adjacent capsules while the root list stays visible but dimmed. Habit and goal details expand to a full-page overlay using the pre-map Events detail structure. Goal detail includes manual positive/negative contribution reports through a compact + / - switch beside the report input. GameHub polls day-boundary conditions and opens wake/profile flows when needed.

PracticeDojo is a non-match session mode. It uses a dojo session UUID to group tasks completed while in dojo, applies dojo contribution, and supports planning/task session interactions without requiring a match.

Durable wake and end-of-day state is shared across profiles for one calendar day where appropriate, while still preserving profile-specific history.

## Feed And Journals

The feed is built from journal entries. Journals are individual Markdown files with metadata and are stored in the linked folder. The app imports valid journal Markdown and ignores files that do not match the required app metadata, allowing Obsidian edits without breaking the app.

Journal entries support title/body editing, images, resource references, tags, comments, detail modal display, and hidden feed-state metadata. Feed ranking uses recent activity signals from tasks, todos, journals, wins, overload, sparse reflection, progress dips, and similar states. A post stores the creation context so it can later be ranked against the viewer's current context.

The feed surface includes list ranking, search/tag matching, image galleries, post composer, journal detail modal, comments, profile pictures, and markdown rendering/editing. In the map shell it uses a full-page opaque overlay, matching the profile-style panel rather than the earlier floating transparent experiment.

## Shop, Inventory, And Pass

The shop sells reward items, duration rewards, cosmetics, consumables, and other game-like items. The current shop ranking uses the feed activity model so item order responds to the player's recent state. For example, overload can emphasize rest/wellness, while sparse completion can promote momentum-building focus rewards.

Inventory shows consumable and activatable items, including quantities, cooldowns, resource images, and item detail/use flows. Cosmetics are profile entitlements rather than usable inventory entries: Shop and Contribution Road can unlock them, desktop Profile configures them, and mobile renders the equipped identity read-only. Contribution is now the broader reputation metric: task rewards and manual goal reports add signed contribution values overall, while goal-linked actions also count in goal-specific rankings. The contribution pass tracks rewards, unlocks, goals, and cosmetics tied to contribution progress. Shop, inventory, and pass all write through persistence after major actions.

The shop layout is intended to feel closer to a video game shop menu than a repeated static grid: featured/recommended items, categories, reasons, visual item presentation, and a separate cart capsule beside the root catalog are part of the product direction. Add/edit item forms use the same adjacent capsule model.

## Achievements

Achievements include catalog data, rarity, checking logic, passive achievement checks, badges, achievement modals, rank progress, and rank-up feedback. Achievements are triggered by sessions, journals, matches, profile progress, inventory/pass actions, and other domain events.

AchievementBadge is shared through the achievements feature public export because many feature screens need to display earned or newly unlocked achievements.

## Persistence

Persistence is local-first and folder-backed. .tapestry is canonical. DatabaseConnection loads from and writes to the linked folder, coordinates save-bundle import/export, handles folder sync, resources, economy state, source handle permissions, profile-scoped stores, IGT-bound reads, events, reminders, notifications, friendships, bans, and compatibility behavior.

Browser storage is not used for canonical records. The source-handle cache is only a pointer for reopening the linked folder. A separate last-known browser location cache may store recent latitude/longitude for map startup only; it is not profile history or durable app data. If the source handle cannot be used, the app returns to folder selection.

Automatic snapshots are root-level datetime zip files created when the app opens. Older app-generated snapshots are removed so only the newest automatic snapshot remains. Snapshots are safety copies; normal saves write the actual .tapestry file data. Routine writes are debounced, major actions force a write, and pending writes are flushed when the page hides or unloads.

## Developer Surfaces

Reusable UI lives in src/shared/ui. Icons live in src/shared/icons. Resource rendering lives in src/shared/resource-image and src/shared/resources. Markdown editing lives in src/shared/markdown-editor. Post images live in src/shared/post-images. Time, rank, task, match, event, feed, shop, achievement, profile, planning, and contribution rules live in src/domain.

Tests use Node's built-in test runner. Build verification uses npm run build. The Vite aliases are defined in vite.config.ts and tsconfig.app.json.

Future feature work should start by deciding whether the change is app coordination, persistence, domain rule, shared utility, or feature UI. That decision usually determines the correct folder and import direction.

Mobile companion implementation and validation details are recorded in docs/MOBILE_PHASE_1_CORRECTNESS.md and docs/MOBILE_PHASES_2_5_COMPLETION.md.
