# Problem (in Peter's words)
"Cleanly remove everything in events tab."

# Change
Remove Events on desktop and mobile. Day start and end are small app-owned prompts using the R1 work window. Inventory owns the active-effects cache. Existing Event habits and wake/sleep checklist steps import once as daily R1 habit todos. General profile settings retain serialized writes that preserve newer profile fields.

# Deleted (files, folders, stores)
`src/features/events/` and `src/domain/events/`, including their UI/habit tests. Day-boundary and active-effects tests move with their remaining shared behavior. Event/Rhythm definitions and routine runs are cleared by migration; past event logs and lifecycle history remain in save bundles.

# Hooks touched
Desktop and mobile navigation, profile history, startup/profile selection, settings, Lobby, matchmaking, hydration requirements, architecture catalog.

# Data impact (migration number, what becomes read-only)
062 converts habits/checklists into repeating todos and clears retired definitions. Journals, completed tasks, coins, goals and matches are preserved. Historical event logs have no Events UI writer.

# Dependencies added (default: none)
None.

# Hand checks (2 to 5 things Peter does by hand)
- Events is absent from desktop and phone navigation.
- Existing habits/checklist steps appear once in Tasks as repeating habits.
- Start day and End work save the R1 work boundary; restarting after ending work can still select a profile and start the day.
- Start a match and use inventory effects successfully.
