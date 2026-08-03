# Mobile companion phases 2–5

This document records the implementation boundaries and validation state for the Today/editors, Goals/Chronicle, Shop/More, and cross-device polish phases. Phase 1 ownership and migration details remain in `MOBILE_PHASE_1_CORRECTNESS.md`.

## Mobile presentation boundary

`MobileAppShell` owns the five-tab companion navigation (`Today`, `Goals`, `Chronicle`, `Shop`, `More`), cached tab panels, mobile route history, the global floating action button, overlay presentation, feedback, and visual-viewport updates. Mobile screens are dedicated compositions over shared repositories and domain commands; they do not embed restricted desktop pages.

`MobileSurfaceContext` is the single owner of transient mobile surfaces. It tracks the surface stack, restores focus after dismissal, installs unsaved-change guards, registers the current page's FAB action, and presents command-result feedback. `MobileOverlayHost` supplies the shared dialog stage, focus trap, Escape/backdrop dismissal, and mobile sheet variants.

Companion-mode selection supports an explicit query/device override, installed-PWA display mode, coarse-pointer compact devices, and a width fallback. The selected device override is local to the device so a narrow desktop window is not forced permanently into mobile mode.

## Phase 2: Today and editors

The Today tab now provides:

- a nearest-reminder card;
- a compact date rail with directional transition state;
- ready-task rows whose left checkbox completes work through the canonical completion path;
- task action, start, complete, edit, delete, move, and system-direction sheets;
- a mobile task composer with parsed date/time/duration confirmation;
- one-minute duration granularity for every positive whole-minute estimate from 1 through 1440;
- reminder action, snooze, edit, delete, and preset-based composer sheets;
- a shell-owned FAB that opens the task composer.

Task draft persistence is centralized in `domain/tasks/TaskDraftCommand.js`. `saveTaskDraftCommand` normalizes recurrence, planning metadata, aversion, duration, due date, description, revision hash, and Goal association before writing. Both the desktop task editor and mobile composer call this command; the UI does not own a second save rule.

Reminder sheets call `saveReminderCommand`, `transitionReminderCommand`, `deleteReminderCommand`, and the existing completion method with `origin: 'mobile'`. Reminder time and agenda presentation calculations are isolated in browser-neutral modules for direct tests.

Feedback is generated from actual command results. Completion preserves reward, recurrence, Goal contribution, Match/Dojo, profile attribution, and sync behavior from the domain service; the mobile layer only selects presentation intensity.

## Phase 3: Goals and Chronicle

The Goals tab shows active and blocked workspace Goals, dedicated detail/history, related task actions, and an update sheet. Goal definitions remain workspace-visible. A submitted update records and rewards the currently active profile through the existing Goal repository and invalidates the focused Goal domains.

Chronicle is a dedicated mobile experience rather than the desktop Feed. It supplies entry cards, a constrained reader, Quick Capture, a draft-restoring composer, and canonical journal publication. Closing an edited draft is guarded, and successful publication refreshes Chronicle state and queues sync.

## Phase 4: Shop and More

The Shop tab has independent Browse, Inventory, and Cart modes plus mobile item details. The Shop catalog is workspace-wide and therefore identical after a profile switch; owned consumables, wallet state, and purchase attribution remain profile-specific. Purchases use `commitShopPurchase`; activation uses `activateShopItemCommand`; authority reconciliation and secondary effects remain in the shared commerce services. Online authority is required only where the configured commerce service already requires it.

Inventory includes usable consumables only. Cosmetic entitlements stay in Browse as `Owned`, render through `ProfileIdentity`, and have no mobile equip/customize action. Desktop remains the configuration surface for themes and equipment.

More contains the active-player header and own-profile sheet, notifications, direct Dojo and Match entry, a compact ranking/Elo neighborhood, and Settings. It intentionally omits public profile search, profile lifecycle administration, and `See all` directory behavior. Mobile Settings contains only Data & Backup, Accessibility, and Privacy; Appearance follows the active profile's desktop-selected equipment.

`createPairMatchCommand` is the mobile matchmaking boundary. It pins the initiating profile, derives an IGT-bounded ghost roster, writes immutable identity/context snapshots, and commits through an idempotent operation ID. Mobile first resumes the same canonical active Match that desktop reads; if none exists, creation uses the same match-ready participant rule as desktop and explains the exact available count. Replaying the same operation returns the existing match without a second mutation. Dojo uses the active profile present when the session begins and the ordinary profile switch is blocked for the session's lifetime. Shared workspace tasks remain valid Dojo candidates even when their legacy creator field names another profile.

## Ownership and profile/session semantics

Workspace-visible planning definitions do not change when the active profile changes:

- Projects and Goals;
- Todos;
- reminders;
- Goal areas, milestones, and links.

The selected profile is explicit on attributed commands and owns:

- completed work and completion receipts;
- Goal updates and contribution;
- rewards, wallet, inventory, cosmetics, Elo, and statistics;
- new Match, Dojo, and action-session identity.

The active profile is a device-local session choice. `switchMobileProfile` validates a live local target, delegates to the canonical database profile lifecycle, reloads the saved current player, invalidates profile/economy/inventory/match/event/social state, reapplies identity tokens through app state, schedules background sync, and leaves workspace planning queries intact. An active action session, Match, or Dojo blocks ordinary switching so already-started work cannot be retagged.

## Offline and cross-device semantics

Local SQLite remains the immediate authority for ordinary mobile commands. Sync operations carry stable operation IDs plus explicit workspace and player attribution. The reconnect test creates, edits, and completes a task while offline, then verifies that one reconnect accepts the mutations once, a second sync uploads nothing, and replaying a duplicate operation does not mutate the domain again.

Supabase now accepts and replays the workspace-planning and Match operation families through owner-scoped, registered-device RPCs. Match lifecycle changes are entity-serialized, monotonic, and idempotent; stale packets receive the canonical current Match rather than rewriting it. Accepted outbox entries are pruned to a 30-day/250-entry bound. Completion recovery writes a versioned terminal receipt, including for imported orphan evidence, so startup does not retry or relog the entire immutable ledger indefinitely.

Task completion, reminder editing, Chronicle capture, item activation, and profile switching do not wait for an immediate network response. Commerce keeps its existing authoritative-online exception. Match creation uses an explicit idempotency key and an immutable profile snapshot so a replay or later profile change cannot duplicate or reattribute it.

An Action Session is the durable authority once work starts. Completion resolves the session's pinned player and recorded Match/Dojo context instead of trusting the currently selected UI profile. A mismatched task target or unavailable pinned profile fails closed. Remote finalization replays the canonical player, Todo, completed-work, contribution, Goal update, Daybook, world, handoff, score, and provenance records under the same operation ID, so retry and reconnect cannot duplicate or reattribute settlement.

## Accessibility and device behavior

The mobile foundation provides safe-area padding, a minimum 44 px control target, 16 px form controls, visual-keyboard-aware sheets, large-text support, high-contrast support, reduced-motion overrides, focus trapping, autofocus on primary editor fields, Escape/back behavior, and focus restoration. Cached tabs preserve local mode/scroll state while dedicated session entry resets stale panel scroll.

Mobile surfaces alias the canonical theme background, input, and text tokens rather than carrying an independent dark palette. This keeps all 17 theme recipes coherent on the companion shell, including light themes, while Accessibility preferences remain device/profile controls layered above the active theme. Theme lookup is profile-specific and guards against a late asynchronous response from the previous profile repainting the newly selected one.

The viewport QA matrix covered `320×568`, `360×800`, `375×667`, `390×844`, `430×932`, and short landscape `667×375`. Checks included horizontal overflow, bezel/safe-area spacing, navigation/FAB positioning, target sizes, sheet footer reachability, input sizing, focus behavior, parsed task values, state restoration, large text, high contrast, reduced motion, direct Dojo layout, and manifest/viewport metadata.

This was browser viewport emulation, not physical-device validation. A real iOS/Android installed-PWA pass is still required to validate OS safe-area values, software-keyboard behavior, VoiceOver/TalkBack announcements, haptics, and standalone launch/service-worker behavior. The live Supabase schema and both new migrations were authenticated, applied, and queried successfully. A physical phone-to-laptop completion was not performed; deterministic local/remote replay tests cover operation transport, canonical attribution, idempotency, and exactly-once settlement.

The installable shell declares standalone metadata, Apple mobile metadata, 192 px and 512 px maskable icons, and an offline navigation fallback. The service worker precaches its manifest and every install icon, version-cleans prior shell caches, and keeps versioned assets available offline.

Local model retention keeps only the active champion, one rollback champion, and the best unpromoted candidate. Mutable training state overwrites a stable checkpoint key rather than accumulating every historical weight set. Remote resource cache bookkeeping is capped at 500 entries/25 MB, and obsolete service-worker cache versions are deleted at activation.

## Commands and query services introduced or formalized

- `queryMobileWorkspaceAgenda` — deduplicated workspace tasks, reminders, and Goals.
- `queryMobileWorkspaceGoals` — workspace Goal overview with active-profile attribution inputs.
- `switchMobileProfile` — validated device-local profile switch and focused invalidation.
- `saveTaskDraftCommand` / `buildTaskDraftRecord` — shared desktop/mobile task draft normalization and save.
- `createPairMatchCommand` — profile-pinned, idempotent mobile pair-match creation.
- `reminderPresetTime` / `resolveReminderSnooze` — browser-neutral reminder timing rules.
- `findInventoryForShopItem` and cosmetic/consumable classification — shared Shop/Inventory ownership matching.

## Validation commands

From the repository root:

```sh
npm test
npm run build
```

`npm test` ran 983 tests with 983 passing. `npm run build` ran TypeScript checking and the Vite production build successfully across 1,120 modules. `git diff --check` also passed. The project defines no separate lint script; no lint result is claimed. Vite reported only its existing dynamic/static import overlap and large-chunk warnings.

Focused coverage includes mobile shell wiring, arbitrary whole-minute task duration, workspace queries and profile switching, task/reminder presentation models, task draft sharing, shared Shop catalog/profile inventory, workspace-wide Dojo candidates, Match and Action Session idempotency/profile pinning, migration 050 preservation, complete Action Session remote replay, offline sync/exactly-once behavior, bounded sync/model/cache retention, terminal completion recovery, all theme recipes, appearance equipment, and PWA runtime/manifest behavior.

## Production release

The final production build was deployed to `https://tapestry-mobile.pages.dev` as Cloudflare Pages deployment `59aacb0a-ec75-4176-b803-8f04cb8332db`. Both the canonical domain and immutable deployment URL redirect unauthenticated requests to Cloudflare Access, so the application remains private. An authenticated browser restore then verified the live `390×844` mobile shell, profile-switcher accessibility, zero horizontal overflow/undersized controls, a scored Dojo recommendation from the shared task queue, and the desktop-aligned Match eligibility message.
