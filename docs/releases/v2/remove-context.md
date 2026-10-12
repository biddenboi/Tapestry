# Problem (in Peter's words)
"Remove context."

# Change
Remove the Context profile tab, Life Context blocks, editors, suggestion/projection services and new Match context captures. The existing friend list is available in a Friends tab. Historical immutable Match snapshots retain their hashes and outcome evidence; their Context content is no longer displayed.

# Deleted (files, folders, stores)
`src/features/profile-context/`, `src/domain/profile-context/`, Context repositories/services and their tests. Context store keys, facade methods, hydration and invalidation wiring are removed. Migration 063 clears all Context records and profile blocks. Historical SQLite schema names remain solely for migration replay.

# Hooks touched
Profile, Lobby, mobile Match creation, Match Arena, profile lifecycle, database facade/runtime, hydration and import/sync guards.

# Data impact (migration number, what becomes read-only)
063 clears Context data. Store-aware retirement filtering rejects Context records in older saves and incoming writes. Friends, writing, tasks, wallet and Match history are preserved.

# Dependencies added (default: none)
None.

# Hand checks (2 to 5 things Peter does by hand)
- Profile has no Context tab, Life Context block or Context Studio.
- Friends remain visible and can still be managed.
- New Matches open without Context capture errors; an old Match still opens with intact outcome evidence.
