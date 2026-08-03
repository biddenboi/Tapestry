# Global Collaborative Feed implementation status

Schema 40 consolidates durable writing around canonical Entries and supersedes the visible Quick Notes destination.

Implemented locally:

- Feed pages: Recent, Global, Wander, Stories, Essays, Yours.
- Yours filters: Active, Drafts, Revisit, Archive.
- Private, Fellows, and Global access presets with centralized view/edit/control policy.
- Atomic Journal head, access, immutable revision, and operation-receipt writes.
- Stale-base conflict retention and conservative merge support.
- Access, revision, receipt, conflict, outbox, and legacy-note mapping stores.
- Idempotent schema-40 and late-legacy-import conversion of Quick Notes to private Entries.
- Revision history and access badges on Entry surfaces.
- Offline Global editing across every local Tapestry profile. Each revision records the active profile as its editor.
- Owner-only access, lock, archive, and restore controls, with content editing available to all local profiles while Global is unlocked.

No server is required. In Tapestry, profiles are temporal identities belonging to the same local person; Global means shared across those profiles in the same SQLite save.
