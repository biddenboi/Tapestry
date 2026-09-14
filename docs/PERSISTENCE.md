# Persistence

Tapestry is local-first and cloud-convergent. SQLite is the durable working copy on a device; Supabase is the cross-device convergence authority. Local storage is never a separate account database: mutations are staged locally, uploaded when possible, and reconciled with newer cloud data.

## Desktop and mobile responsibilities

Desktop stores the complete SQLite workspace and can run every feature offline. It keeps database state and unsynchronized changes separately: each local command commits its canonical rows and its operation/reference outbox rows atomically. A crash or restart cannot lose the fact that a committed change still needs upload.

Mobile stores a mobile-safe working set, not the desktop database checkpoint. An already-restored phone can continue using cached profiles, planning, sessions, competition, commerce, Chronicle, Event, achievement, and social records while offline. Clearing that site data removes the cache; a new or cleared phone must reconnect before it can reconstruct the working set. Resource bytes are fetched by reference and kept under a smaller mobile cache budget.

Both surfaces always pull newer data from the cloud when connected. Conflict reconciliation compares per-record update evidence and protects newer pending local mutations from an older remote row. Deletes travel as durable tombstones so an offline delete cannot be resurrected by stale data.

## Synchronization lanes

Synchronization moves changes, not database images.

- Live (no debounce): active-profile boundaries, completed tasks, Action Sessions, Matches, and Match score events. Foreground clients also reconcile this narrow set every 1.5 seconds and react to realtime server nudges.
- Prompt (750 ms): task editing, profiles, Goals and Goal structure, task-completion receipts, reminders, shop catalog, inventory, transactions, and Event definitions.
- Background (15 seconds after a local commit, plus periodic/online/foreground retry): Journals, comments, Chronicle history, Event completions and logs, contribution/stat history, achievements, friendships, notifications, and other non-session state.

Network failure never rolls back the local command. Pending rows remain in SQLite, retry with bounded backoff, and upload after connectivity returns. Successful operation history is pruned only after acknowledgement; recent receipts remain for diagnostics and idempotency.

## Full desktop checkpoint

Desktop maintains the full persistent SQLite database locally and periodically uploads a verified SQLite checkpoint as a recovery backup. Checkpoints are deliberately outside the latency-sensitive sync transaction, are generated only after pending writes flush, and pass SQLite quick-check and foreign-key validation before upload.

A clean desktop may restore the newest checkpoint, then apply newer reference and operation rows. A working desktop opens its local database immediately, including when offline. Checkpoint publication is gated until a clean-device restore decision finishes, preventing an empty device from overwriting a good backup.

Mobile never uploads or downloads the full checkpoint. Its clean-device bootstrap pages through owner-scoped mobile reference rows and repairs the normalized projections needed by IGT, Elo, Points, contribution, Matches, and graphs.

## Portable ML artifacts

Task Recommender v12 training remains a desktop responsibility. Only app-setting records with the `task-recommender-v12-` prefix are captured as `ml-model` references. Mobile downloads those portable model artifacts for local inference; unrelated settings, optimizer/training state, analytics, exports, and recovery artifacts are excluded.

## Import, export, and recovery

ZIP import/export remains a deliberate recovery path. Export crosses a durability barrier and includes a verified SQLite snapshot plus portable resource data. Import validates the snapshot before replacing live state, applies pending migrations, and restores the previous verified snapshot if promotion fails.

The former linked-folder/Markdown format remains supported through migration and recovery tooling, but it is not a second live source of truth. Normal application writes target SQLite and the mutation outboxes.

## Derived state

Leaderboard snapshots, profile summaries, Elo journeys, contribution totals, Dojo standings, feed ordering, and other projections are rebuildable from canonical rows. Remote application queues and flushes these projections before announcing synchronization completion so React observes consistent Elo, Points, IGT, contribution, and graph values together.

## Platform transport boundary

The web app uses HTTPS, Supabase realtime, service workers, and Web Push. Safari on iPhone does not expose Web Bluetooth, so a browser/PWA cannot implement direct Bluetooth database transfer. The synchronization contracts are transport-neutral enough for a future native iOS or desktop companion transport, but the production web app must not claim peer-to-peer Bluetooth support.
# Sync and settings repair (September 2026)

Storage maintenance uses verified SQLite `VACUUM` to reclaim unused pages,
including offline. It does not clear records, pending outboxes, accepted receipts,
conflicts, history, or backup files. The storage panel reports reclaimable space
and savings from content-addressed image reuse. The production build stamps the
service worker with a deterministic build ID so activation retires obsolete
app-code caches instead of accumulating hashed assets in one permanent cache.
Only known shell/asset caches are retired; other caches are untouched. Concurrent
scheduled/manual encrypted backups share one in-flight export.

Sync-only SQLite acknowledgements, cursor advances, retries, and device metadata
do not schedule another sync or dirty the recovery checkpoint. Remote reference
application also avoids echo uploads. Local edits retain the existing live,
750 ms prompt, and 15 second background priorities, with reconnect catch-up and
exponential retry. Reference writers share one queue; acknowledgements match
the exact sent payload as well as its timestamp before removing outbox entries.

Reference requests time out after 60 seconds and leave unsuccessful edits in
the durable outbox. Upload batches are bounded by both count and encoded bytes:
up to 500 records / 2 MiB normally, or 50 records / 256 KiB when the browser
reports a slow connection or data-saving mode. One oversized record travels
alone. Browsers without network hints use the normal bounded policy.

Settings merge only edited fields into the latest profile. Related profile
read-modify-write operations are serialized, unchanged ritual settings skip
writes, and general settings cannot be submitted by a nested account form.
Policy controls update immediately and report persistence failures. Expensive
recommender state loads only on the Advanced page.

Download backup creates one verified local package, including pending edits.
Concurrent download requests share the same build. This action does not force
a separate cloud checkpoint, and works offline. Existing backup files are
retained. Scheduled desktop recovery and cloud checkpoints remain separate
recovery mechanisms.

Deploy `20260914010000_reference_cursor_correctness.sql` with the client. It
retains records and cursors, returns `record_updated_at` in deltas, ignores
receipt-only updates when allocating versions, and serializes cursor allocation
per owner. `supabase/tests/reference_cursor_correctness.sql` exercises the
contract on an isolated PostgreSQL fixture; the Node suite covers concurrent
uploads, same-millisecond acknowledgements, retries, and overlapping settings.
