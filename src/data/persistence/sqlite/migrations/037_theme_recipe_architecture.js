export const THEME_RECIPE_SCHEMA_SQL = `
CREATE TABLE theme_recipe_manifests (
  theme_id TEXT PRIMARY KEY,
  recipe_version INTEGER NOT NULL DEFAULT 1 CHECK (recipe_version>=1),
  mode TEXT NOT NULL CHECK (mode IN ('light','dark')),
  icon_pack TEXT NOT NULL,
  illustration_pack TEXT NOT NULL,
  navigation_recipe TEXT NOT NULL,
  surface_recipe TEXT NOT NULL,
  typography_recipe TEXT NOT NULL,
  world_recipe TEXT NOT NULL,
  achievement_recipe TEXT NOT NULL,
  contrast_profile TEXT NOT NULL CHECK (contrast_profile IN ('standard','high')),
  supports_reduced_motion INTEGER NOT NULL DEFAULT 1 CHECK (supports_reduced_motion=1),
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE theme_migration_receipts (
  profile_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  selected_theme_id TEXT NOT NULL,
  ownership_preserved INTEGER NOT NULL DEFAULT 1 CHECK (ownership_preserved=1),
  pricing_preserved INTEGER NOT NULL DEFAULT 1 CHECK (pricing_preserved=1),
  migration_id TEXT NOT NULL,
  migrated_at TEXT NOT NULL
) STRICT;

INSERT INTO theme_migration_receipts(
  profile_id,selected_theme_id,ownership_preserved,pricing_preserved,migration_id,migrated_at
)
SELECT
  p.id,
  COALESCE(
    (SELECT json_extract(pc.value_json,'$') FROM player_cosmetics pc
     WHERE pc.player_id=p.id AND pc.slot='theme'),
    'minimalist'
  ),
  1,
  1,
  '037_theme_recipe_architecture',
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM players p
WHERE 1=1
ON CONFLICT(profile_id) DO NOTHING;
`.trim();

export const migration037 = Object.freeze({
  id: '037_theme_recipe_architecture',
  description: 'Add versioned semantic theme recipe manifests while preserving stable IDs, ownership, prices, unlock receipts, and profile selection.',
  sourceApplicationVersion: 'theme-recipes-v1',
  sql: THEME_RECIPE_SCHEMA_SQL,
  checksum: '03ce8783da649be49103b168a8ccbd6795be89ffc3f74bf02022a1efc1e427a2',
});

export default migration037;
