export const DURABLE_REFERENCE_OUTBOX_SQL = `
CREATE TABLE sync_reference_outbox (
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  store_name TEXT NOT NULL,
  player_id TEXT,
  workspace_id TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0,1)),
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploading')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(record_type,record_id)
) STRICT;

CREATE INDEX sync_reference_outbox_pending_idx
ON sync_reference_outbox(status,updated_at,record_type,record_id);

CREATE TABLE sync_reference_meta (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at TEXT NOT NULL
) STRICT;

PRAGMA optimize;
`.trim();

export const migration051 = Object.freeze({
  id: '051_durable_reference_outbox',
  description: 'Persist a retryable latest-state cloud outbox with deletion tombstones for every mobile-safe record mutation.',
  sourceApplicationVersion: 'tapestry-durable-cloud-v1',
  sql: DURABLE_REFERENCE_OUTBOX_SQL,
  checksum: '667846416ff46be0ada44ad58c87b34fd2871cb882ef97afd0483c61615566bf',
});

export default migration051;
