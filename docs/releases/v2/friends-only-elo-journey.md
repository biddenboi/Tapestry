# Problem (in Peter's words)
"Have elo journey only show friends."

# Change
The Lobby chart keeps your own journey and compares only accepted friends, using the existing IGT-filtered friend rating projection.

# Deleted (files, folders, stores)
None.

# Hooks touched
Lobby materialized-data reader.

# Data impact (migration number, what becomes read-only)
None.

# Dependencies added (default: none)
None.

# Hand checks (2 to 5 things Peter does by hand)
- Open Elo Journey: only you and accepted friends appear.
- End a friendship: that comparison disappears on refresh; other rated profiles stay absent.
