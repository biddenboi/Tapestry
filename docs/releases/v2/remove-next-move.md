# Problem (in Peter's words)
"Remove next move."

# Change
Remove Next Move recommendations, drawer, edge trigger, placement controls and navigation policies. A small session dock appears only while a task session is minimized so existing work can still be reopened, paused or finished.

# Deleted (files, folders, stores)
`src/features/navigation/`, `src/domain/navigation/`, Next Move repositories and their tests. Decision, feedback and placement store keys, domain subscriptions, hydration and routing are removed. Migration 064 clears their records; old schema names remain for migration replay. Task window eligibility moves to planning because task planning still uses it.

# Hooks touched
GameHub, task session surfaces, hydration, revisions, persistence, profile lifecycle, sync and save import boundaries.

# Data impact (migration number, what becomes read-only)
064 clears only Next Move records. Retired store filtering prevents older saves or incoming sync writes from restoring them. Task plans, active sessions, tasks, wallet, writing and R1 scheduling events remain intact.

# Dependencies added (default: none)
None.

# Hand checks (2 to 5 things Peter does by hand)
- No Next Move edge button, drawer or recommendation appears while idle.
- Start a task, minimize it, reopen it, pause/resume it and finish it; elapsed time and rewards settle once.
- An unfinished task session still restores after restarting the app.
