export const EFFECT_INTERVALS_SQL = `
CREATE TABLE effect_intervals (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  effect_scope TEXT NOT NULL,
  multiplier REAL NOT NULL CHECK(multiplier >= 0),
  stacking_rule TEXT NOT NULL CHECK(stacking_rule IN ('multiply','additive','highest')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  policy_version INTEGER NOT NULL CHECK(policy_version > 0),
  created_at TEXT NOT NULL,
  CHECK(ends_at > starts_at),
  UNIQUE(player_id,source_type,source_id,effect_scope,starts_at)
) STRICT;

CREATE INDEX effect_intervals_player_window_idx
ON effect_intervals(player_id,starts_at,ends_at,effect_scope);

PRAGMA optimize;
`.trim();

export const migration047 = Object.freeze({
  id: '047_effect_intervals',
  description: 'Add immutable, versioned duration-effect intervals for deterministic cross-device scoring.',
  sourceApplicationVersion: 'mobile-arena-sync-v1',
  sql: EFFECT_INTERVALS_SQL,
  checksum: '2d0192d40895e77446b6b16697ec4c8940abdd8839b9b4884ddc74181c3437a5',
});

export default migration047;
