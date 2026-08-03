# Mobile sync, cloud durability, and layout repair

## Root causes

1. `SupabaseSyncBootstrap` could begin two full working-set publications at the same time. The second session invalidated the first token and produced `The mobile working-set publish session is no longer active.`
2. Mobile restored an older full snapshot after ordinary operation-log sync. A deletion could reach the server and then be undone when that stale snapshot recreated the record.
3. Many successful SQLite writes never entered the cloud operation outbox. For those paths, “saved” meant only saved in the current local database.
4. Active-profile selection was device-local. Profile records, IGT clocks, leaderboard snapshots, and the selected profile could therefore describe different states.
5. Routine mobile reference upload could send stale profile clocks back to the server and overwrite newer desktop IGT state.
6. Full-database publication was not gated during clean-device startup. A newly opened device could become the latest cloud checkpoint before restoring the real account database.
7. Downloads could package local data without first crossing a cloud-durability barrier.
8. The task page treated horizontal drift during a vertical scroll as a date swipe.
9. Chronicle grid and Markdown children retained intrinsic minimum widths, allowing long entries to extend beyond the viewport.

## Durability model

### Record-level synchronization

- Migrations 51 and 52 add a persistent reference outbox and SQLite capture triggers.
- All 39 mobile-editable canonical document stores are covered by INSERT, UPDATE, and DELETE triggers: 117 triggers in total.
- A successful canonical write queues its latest record state in the same SQLite transaction.
- A successful deletion queues a tombstone in the same transaction, preventing a stale device from recreating the deleted record.
- Pending outbox records survive reloads, offline periods, process termination, and failed requests. They remain pending until the server acknowledges them.
- Remote records are reconciled against pending local writes before touching SQLite. Newer local writes and tombstones win over stale server state.
- Remote wrapper timestamps are persisted as `syncUpdatedAt`, preventing repeated echo/reapply loops.

### Full database checkpoints

- Every successful SQLite mutation marks the full database checkpoint dirty below feature code. Individual screens do not need to remember to request a backup.
- Desktop publishes a verified `tapestry.sqlite` checkpoint to the private account storage path. Publications are throttled during normal use and forced when the app backgrounds, closes, or exports data.
- The database object is uploaded before the account-level `latest.json` pointer is changed, so the pointer cannot advertise a checkpoint that does not exist yet.
- Full-checkpoint publication is disabled until a clean desktop has restored the existing cloud checkpoint. This prevents an empty or partial database from replacing the account’s latest copy.
- Mobile never publishes the full SQLite checkpoint because its database is intentionally a mobile subset. Mobile still sends every supported record mutation through the durable record outbox.

### Cloud-first startup and downloads

- A clean desktop signs into Private Sync and restores the latest full SQLite checkpoint before enabling publication.
- ZIP/folder import is recovery-only; it is no longer the normal way to reopen the app on another device.
- Older accounts without a full checkpoint fall back once to operation/reference bootstrap, then establish the first full desktop checkpoint.
- Export waits for local writes, record sync, and a forced cloud checkpoint before constructing the ZIP.
- While online, a failed durability flush blocks the export rather than silently producing a package whose server state is behind.
- The package contains the verified current `tapestry.sqlite` plus its manifest and associated portable resources. Offline export still contains the exact local database and records that it could not confirm server durability.

## Other sync repairs

- Routine synchronization uses the operation log and bounded reference records. It no longer replaces the working set after every sync.
- Full working-set publications are serialized. Identical concurrent requests share one session, and an inactive session restarts once with a fresh token.
- A versioned repair manifest performs one bounded reconciliation for devices previously poisoned by stale snapshot restoration.
- Realtime sync listens for operation-log and reference-record changes.
- Active-profile selection is timestamped and synchronized.
- Mobile profile changes are allowed only through Start Day / End Day. Routine mobile sync is download-only for profile clocks.
- Mobile competition queries rebuild materialized projections before presenting Points, Contribution, Match Elo, IGT, or Elo history.

## Layout repairs

- Day navigation requires a deliberate, horizontally dominant swipe, so vertical task scrolling cannot change the selected day.
- Chronicle cards, readers, Markdown, media, code blocks, and tables are constrained to the mobile viewport.

## Deployment requirements

The application deployment must use the updated source and the existing private Supabase storage bucket must permit authenticated users to read and write paths beneath their own owner ID. The patch cannot alter or verify the live deployment or its remote policies by itself.

After deployment, start desktop while signed into Private Sync. Let it restore or establish the cloud checkpoint, then open or refresh mobile. Do not clear existing local storage before this first repaired reconciliation.

## Validation

The expanded dependency-free regression suite passes 30/30 tests. It covers durable trigger capture, cloud checkpoint upload/download, clean-device publication gating, export durability, publication coalescing, inactive-session retry, stale-record reconciliation, active-profile synchronization, boundary-only mobile profile selection, swipe-axis filtering, Chronicle constraints, and mobile shell wiring.

The generated migration was also executed against SQLite directly: all 117 triggers were created, and insert/delete capture including tombstones was verified.

A full Vite production build was not run because the uploaded archive does not include `node_modules`, and the offline package cache is incomplete.
