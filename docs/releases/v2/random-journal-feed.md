# Problem (in Peter's words)
"Scrape all of feed and replace it by only returning random past journals with each scroll."

# Change
Feed contains only visible past journals in shuffled batches. Scrolling near the bottom appends another batch; each pass visits the available archive before reshuffling. A More journals button supports keyboard use and short archives. Queries preserve publication, privacy and IGT boundaries.

# Deleted (files, folders, stores)
Feed's Recent/Global/Wander/Stories/Essays/Yours tabs, composer controls, filters, chronology and old Feed styles. Obsolete finite-feed and tab wiring tests are replaced with journal shuffle and visibility coverage. Chronicle editors and profile history remain.

The obsolete Feed, post composer and journal reader adapters and their unused styles are also deleted. Profile opens the canonical Chronicle reader directly.

# Hooks touched
Feed reader, journal query and Feed route catalog.

# Data impact (migration number, what becomes read-only)
No journal data changes. The reader performs no writes.

# Dependencies added (default: none)
None.

# Hand checks (2 to 5 things Peter does by hand)
- Feed shows only past journals with no former tabs or filters.
- Scroll down: more random journals appear, including another shuffled pass after exhausting the archive.
- Open a journal and verify its full content; another profile's private/draft/future writing stays absent.
