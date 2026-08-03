# Mobile Phase 1 correctness

Phase 1 establishes the ownership and attribution boundaries required by the mobile companion. It does not include the Phase 2 Today redesign or later mobile presentation work.

## Ownership model

Workspace-visible definitions:

- Projects and Goals
- Todos
- Reminders
- Goal areas, milestones, and links
- Shop catalog items

Active-profile attribution:

- Completed task history and completion receipts
- Goal updates and Contribution
- Points, rewards, wallet, inventory, cosmetics, Elo, and statistics
- Active Match, Dojo, and action-session identity

`MobileAgendaQueryService` and `MobileGoalsQueryService` query workspace definitions without filtering by the active profile. Legacy unscoped records belong to `workspace:default`; duplicate UUIDs resolve to the newest record. Completing a Todo still calls `TaskCompletionService`, which pins the completed task, completion event, and reward to the profile passed to the command.

`MobileShopQueryService` follows the same boundary: catalog availability is queried once for the workspace, while inventory ownership and purchase state are resolved for the selected profile. The task recommender also treats the shared Todo queue as its candidate set; the active profile still owns its private model, recommendation ledger, and resulting completion.

## Profile switching

`MobileProfileSwitchCommand` validates the target against non-archived, non-banned local profiles and delegates the change to `databaseConnection.switchProfile`. It reloads the canonical current-player record, updates the app session (which reapplies equipped theme/cosmetic tokens), invalidates profile-dependent domains, announces success, and schedules background sync without waiting on the network.

Ordinary switching is blocked while an action session, Match, or Dojo identity is active. This prevents an in-flight session from being retroactively attributed to another profile. Tasks, Goals, and reminders are deliberately absent from the switch invalidation set.

The mobile profile surface contains only the user's local profile list. Public search and mobile profile authoring/configuration are not exposed.

## Cosmetics and Inventory

`isCosmeticItem` classifies cosmetic item types, and `InventoryRepository.getConsumablesByPlayer` excludes them from ordinary Inventory. The Inventory page has no equip/customize path. Mobile profile cards, the switcher, and leaderboard rows use shared `ProfileIdentity`, which reads the profile's desktop-equipped title, frame, theme, avatar, and rank presentation.

## Persistence and sync

SQLite migration `050_workspace_planning_scope`:

- creates `workspaces` and `workspace_profiles`;
- adds every live local profile to `workspace:default`;
- backfills workspace and creator scope for planning definitions and their document JSON;
- adds workspace indexes for planning reads and sync operations;
- preserves legacy non-null player owners;
- reparents shared definitions before profile deletion, or refuses deletion when no live fallback exists.

Outgoing operation envelopes, the local sync outbox, Supabase sync-log rows, mobile reference records, and reference RPC responses carry `workspaceId` independently from `playerId`. Workspace definitions publish with `playerId: null`; profile-attributed history retains its player ID.

The live Supabase project has migrations `20260802230000_workspace_planning_scope.sql` and `20260802235900_match_sync.sql` applied. Migration history was repaired only after a live function/table audit verified the pre-existing versions. The resulting remote history matches all 13 local migrations, and the live schema exposes `workspace_id` plus the owner-scoped Match batch RPC.

The migration test seeds a pre-050 database with two live profiles, one archived profile, planning records, Goal definitions, completed work, and document shadows. It verifies backfill, membership, JSON preservation, creator deletion reparenting, and last-live-profile protection.
