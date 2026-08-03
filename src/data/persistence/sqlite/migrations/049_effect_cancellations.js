export const EFFECT_CANCELLATIONS_SQL = `
CREATE TABLE effect_cancellation_receipts (
  id TEXT PRIMARY KEY,
  interval_id TEXT NOT NULL UNIQUE,
  player_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  cancelled_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(interval_id) REFERENCES effect_intervals(id) ON DELETE RESTRICT,
  CHECK(cancelled_at >= created_at)
) STRICT;

CREATE INDEX effect_cancellations_player_time_idx
ON effect_cancellation_receipts(player_id,cancelled_at,interval_id);

PRAGMA optimize;
`.trim();

export const migration049 = Object.freeze({
  id: '049_effect_cancellations',
  description: 'Add immutable, idempotent cancellation receipts for duration effects.',
  sourceApplicationVersion: 'mobile-daily-companion-v2',
  sql: EFFECT_CANCELLATIONS_SQL,
  checksum: '0629eb0fd4867bdee53482abfe8578cd66541136464aaf058fd16fc730284ab6',
});

export default migration049;
