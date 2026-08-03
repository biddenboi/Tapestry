# Mobile sync phase 0 audit

Date: 2026-08-02  
Scope: synchronized v1 domains from `TAPESTRY_MOBILE_COMPANION_IMPLEMENTATION_SPEC.md`

## Current write-path inventory

The audit found 134 feature/domain calls to the durable facade (`add`, `remove`,
`clear`, `commitAtomicMutation`, protected-note commands, reminder transitions,
and profile selection). The generic facade remains necessary for desktop
compatibility, but it is not a network protocol. New mobile and remote code must
enter through an explicit domain command and a stable operation ID.

| Domain | Existing canonical boundary | Direct-write risk | Phase 0 action |
|---|---|---:|---|
| Task creation/edit | Todo editor + task repository | High | Use the synchronized command envelope for new cross-device entry points. |
| Task completion/recurrence | `completeTask` | Critical | One atomic primary commit, stable operation ID, stable occurrence key. |
| Dojo/Match action sessions | `ActionSession` functions | Critical | Stable transition operation IDs; local mutation and outbox share a transaction. |
| Match score | immutable `match_score_event` evidence | Low | Keep deterministic event ID; finalize through a stable operation receipt. |
| Reward provenance | immutable provenance ID | Low | Persist through a stable operation receipt. |
| Shop purchase | `commitShopPurchase` | Critical | Purchase batch ID is the operation ID; remains online-authoritative once transport is enabled. |
| Reminders | reminder query service | Medium | State transitions require explicit commands before mobile wiring. |
| Routines | lifecycle services | High | Phase 5 adds normalized runs/step receipts; no mobile entry point yet. |
| Chronicle | revision/conflict/outbox repositories | Medium | Reuse revision commands; remote application cannot create an outgoing sync operation. |
| Goals | `GoalRepository` atomic methods | Medium | Read-only mobile in v1; desktop edits receive versioned commands later. |
| Profiles | profile lifecycle service | Medium | Profile selection stays local; shared profile writes remain desktop-only in v1. |

## Data boundary

The executable classification is in `src/data/sync/SyncDataPolicy.js`.

- Shared: profiles required for lookup, task/Goal/reminder facts, active and
  recent sessions, Match evidence, rewards/balances, commerce receipts,
  inventory/effects, routine evidence, Chronicle records/revisions, and minimal
  social/profile lookup records.
- Device-local: selected profile, navigation/panel state, drafts that have not
  been published, local notification receipts, and local presentation settings.
- Derived: recommender weights/snapshots, materialized caches and indexes,
  diagnostics, background rebuild jobs, and exports/backups.
- Attachment metadata only: resource IDs, hashes, MIME type, byte size, and
  relationships. Image/PDF/audio/video bytes do not enter live row sync.

## Command invariant

Offline-capable cross-device commands must call `commitAtomicMutation` with a
stable `operationId` and a sync context. SQLite commits the canonical document
mutation, immutable evidence, and `sync_operations` row in one worker-owned
transaction. `origin: remote-sync` is rejected if `enqueueSync` is true.

The current desktop-only call sites remain local and behave as before. They are
not silently converted into generic row-sync operations; each v1 mobile feature
must adopt its named domain command before the corresponding screen is enabled.
