## Problem (in Peter's words)

“R1 picks the next task.” Next Move needs one scheduling source, using observable todo facts and real session history.

## Change

Port Lot commit `c363f6e` with kA = 2, Module 2, shifted recurring starts, and pooled habit pacing. Peter approved preserving Lot's fractional local-day hours for exact fixture parity. Next Move displays R1's task, rest, reward, wait, or free-time decision and its reason; alternatives come from R1's allowed set, and user choices record the suggested target.

Todo start dates and habit minimums feed an append-only local event history. Source changes and R1 events commit together. Sequence allocation is serialized, failed writes leave the read cache unchanged, and Module 2 holds survive replay. Day entry and end work record a local availability window. The existing sleep time supplies its planned end until End work closes it sooner.

The Gate also locks in margin mode. Locking an item creates a task in category Tapestry, using the estimate entered from its design note and the release window close as its deadline. Coins, ledger, Gate state, and the task save together. Returning or finishing an item retires or completes that task. Peter approved adding Estimate (minutes) to the note template and lock form.

## Estimate (minutes)

Enter the approved design estimate when locking this release's Gate item. Estimates for future items are required as positive whole minutes at lock time.

## Deleted (files, folders, stores)

None. Next Move's former priority/shortest-estimate pick and its independent orientation/recovery scoring are replaced. Planning and Events remain for their later Gate items.

## Hooks touched

Todo command boundary, recurring completion, Action Session settlement, shop purchase capture, Next Move state/cards/alternatives, wake/end-work boundaries, reward setting, and Gate commands.

## Data impact (migration number, what becomes read-only)

Migration 060 adds optional start and habit projections; 059 was already occupied by the merged retirement work. Migration 061 adds r1Events. Registered migrations remain unchanged. R1 events reject updates, generic command deletes are prohibited, and row sync excludes the store. Save/restore can still carry the history. Profile removal retains workspace event history.

The guarded CLI operates on an extracted SQLite copy:

```sh
node scripts/r1-backfill.mjs /absolute/path/to/COPY.sqlite
node scripts/r1-backfill.mjs /absolute/path/to/COPY.sqlite --apply
```

The first command only reports the proposed backfill. The second validates/applies registered migrations and appends small records in one transaction. An existing R1 event history causes a no-op. Run the history import before live todo edits or overrides initialize the store.

The October 12 save-bundle copy produced 863 events for 318 completed tasks and six open todos. Verified logged time is 6,222.6648 minutes. Ninety-seven completed records have ambiguous or absent duration, so no time is inferred for them. The completed history spans January 30–August 2 in UTC (January 29–August 2 in America/Chicago). Peter approved using verified durations from that bundle. The live database has not been backfilled by this work.

The existing sync risk remains: a server-owned wallet reconcile can undo a local Gate charge.

## Dependencies added (default: none)

None.

## Hand checks (2 to 5 things Peter does by hand)

1. Compare Next Move with Lot for the same todos across three real days, including a habit spacer and an availability window ending at a fixed reminder.
2. Start an allowed alternative and close it; the R1 pick returns. Check the suggested target is retained in the override record.
3. Close a recurring todo late and check tomorrow's occurrence; buy a duration reward and check reward time used today.
4. Lock a Gate item with the note's estimate, check its Tapestry task/deadline and charge, then finish or return it. Check due-today work and margin mode lock Gate actions while capture remains available.
5. Confirm the copy's backfill summary fits remembered history before applying it to a live save, export a fresh save bundle, then follow the release procedure.
