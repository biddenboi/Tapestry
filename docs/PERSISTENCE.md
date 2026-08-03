# Persistence

Tapestry is local-first. The selected folder is the source of truth, and .tapestry/ inside that folder contains the canonical app save. Runtime memory is a loaded view of those files, not a second durable database.

## Canonical State

Canonical records are written through the save-bundle format. Browser-managed storage is not canonical and should not contain app records. Acceptable browser caches are limited to the source-handle cache that helps the File System Access API reopen the selected folder after refresh and the last-known browser location cache used only to center the map before the next geolocation ping.

Key durable areas:

- .tapestry/.system-data/: app state, economy state, save metadata, cross-profile state, and other system records.
- .tapestry/.player-data/: player records and player-scoped structured data.
- .tapestry/.shop/: shop catalog, inventory state, rewards, and item data.
- .tapestry/.resources/: binary-like resources or base64-backed resource records referenced by app data.
- .tapestry/journals/: individual journal Markdown files.
- root zip snapshot: automatic open-time backup of .tapestry, named by datetime.

Derived statistics, projections, feed rankings, shop rankings, match estimates, and profile summaries should be reproducible from canonical records.

## Folder Access Lifecycle

1. Desktop opens through DataSourceGate and asks for a folder if no valid source is available. A clean mobile device instead signs in to Private Sync and restores the bounded mobile working set from Supabase before replaying the operation log.
2. DatabaseConnection loads or initializes .tapestry/.
3. App state is held in memory for rendering and writes are flushed to files. Routine writes are lightly debounced, while major actions force a write.
4. Periodic and visibility-change sync pulls external edits from disk when no local write is pending. Pending writes are flushed when the page hides or unloads.
5. If the folder is missing or access is revoked, the app clears loaded state and returns to the folder picker.

A missing folder should not corrupt state. It should behave like Obsidian losing vault access: stop using stale data and ask the user to locate a valid folder.

## Journal Markdown Rules

Journals are real Markdown files under .tapestry/journals/. The body can be edited outside the app. Files are imported only when they contain the expected metadata required to identify them as app-owned journal entries. Markdown files without valid journal metadata are ignored.

The durable journal metadata includes identity, parent profile, title, timestamps, in-game timestamp, tags, images/resource references, and hidden feed-state metadata. The visible Markdown body remains editable so Obsidian edits do not break the app.

When a journal is saved in the app, the Markdown file and any related manifest/resource data should be written immediately.

## Linked Folder Sync

Linked-folder writes replace the managed save files directly. Major actions should flush immediately, including:

- saving or editing a journal;
- completing a task session;
- finishing a match;
- buying or using a shop item;
- changing profile settings, cosmetics, or inventory state;
- accepting day-boundary events such as wake or sleep.

Inbound sync should compare durable content and refresh app state only when disk changed. It must not pull from disk over a pending local write. If source access fails because the folder is gone, App.jsx returns to the folder picker.

## Snapshots

Every app open creates one root-level zip snapshot of .tapestry. The filename is based on the save datetime. Existing app-generated datetime zip snapshots are removed so there is only one automatic snapshot at a time.

Snapshots are safety copies, not a separate persistence layer. The app should continue to read and write the actual files under .tapestry during normal use.

## Import And Export

Zip import/export uses the save-bundle format. Import must validate durable state before replacing in-memory records. New optional files should have default values so version 1 bundles remain readable. Paths inside zips must be normalized and must not escape the bundle root.

Resource references should remain relative and portable. Player image payloads should not be duplicated inside JSON when they are already represented as resources.

## Economy And App State

Global money lives in .system-data/economy.json. Cross-profile app state lives in .system-data/appState.json. Profile-owned state stays with the profile records unless it is explicitly global.

The active profile is a device-local choice. Planning definitions are different: migration `050_workspace_planning_scope` creates the default workspace and membership rows, then adds `workspace_id` to projects, Todos, reminders, completed tasks, Goal areas, milestones, links, and outgoing sync operations. Definition tables also retain nullable `created_by_player_id`; legacy non-null player owners remain during the compatibility period. Deleting a profile reparents shared planning definitions to another live workspace profile, and deleting the last live owner is refused when shared planning still exists.

Mobile reference records and sync-log entries carry `workspaceId` separately from `playerId`. Workspace planning definitions use the owner account plus workspace scope for visibility and do not use `playerId` as the remote visibility key. Profile-attributed completions, updates, rewards, inventory, and cosmetic state continue to carry `playerId`.

Economy migration should normalize legacy values and reject invalid payloads before restore. Tests in src/data/db/economyState.test.mjs cover global money round-tripping and invalid restore behavior.

## Source Handle Cache

The source-handle cache stores the browser-managed handle and minimal metadata needed to request permission again. The last-known location cache stores only recent browser coordinates for map centering. Neither cache may store journal bodies, player data, economy values, resources, feed records, matches, or other app records.

If the cached handle cannot be used, the user should see the folder picker instead of a broken loaded app.
