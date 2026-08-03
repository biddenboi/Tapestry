export const CROSS_DEVICE_SYNC_FOUNDATION_SQL = `
CREATE TABLE sync_devices (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  retired_at TEXT
) STRICT;

CREATE TABLE sync_operations (
  operation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  player_id TEXT,
  device_id TEXT NOT NULL,
  device_sequence INTEGER NOT NULL,
  command_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  base_version INTEGER,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending','uploading','accepted','conflict','rejected'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  server_sequence INTEGER,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(device_id, device_sequence)
) STRICT;

CREATE INDEX sync_operations_pending_idx
ON sync_operations(status, device_sequence);

CREATE TABLE sync_cursors (
  stream_name TEXT PRIMARY KEY,
  server_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_payload_json TEXT NOT NULL CHECK (json_valid(local_payload_json)),
  server_payload_json TEXT NOT NULL CHECK (json_valid(server_payload_json)),
  base_version INTEGER,
  server_version INTEGER,
  status TEXT NOT NULL CHECK (status IN ('open','resolved-local','resolved-server','merged')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;

CREATE INDEX sync_conflicts_open_idx
ON sync_conflicts(status, created_at, id);

PRAGMA optimize;
`.trim();

export const migration046 = Object.freeze({
  id: '046_cross_device_sync_foundation',
  description: 'Add durable device identity, operation outbox, pull cursors, and visible sync conflicts.',
  sourceApplicationVersion: 'mobile-sync-foundation-v1',
  sql: CROSS_DEVICE_SYNC_FOUNDATION_SQL,
  checksum: '8168d59720cb7db91d39386b99aead048d71d9a8d92ffbcd9fae07f22648b343',
});

export default migration046;
