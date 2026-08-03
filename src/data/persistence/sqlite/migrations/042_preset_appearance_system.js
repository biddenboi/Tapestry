export const PRESET_APPEARANCE_SCHEMA_SQL = `
INSERT INTO contribution_road_catalog_versions(
  catalog_version,catalog_id,activated_at,metadata_json
) VALUES(
  2,'recognition-board-and-preset-appearance-v2',CURRENT_TIMESTAMP,
  '{"layout":"chapter-focus","classicRewards":"integrated","cosmeticCatalogVersion":1}'
);

CREATE TABLE cosmetic_catalog_versions (
  catalog_version INTEGER PRIMARY KEY CHECK (catalog_version>=1),
  catalog_id TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  manifest_count INTEGER NOT NULL DEFAULT 0 CHECK (manifest_count>=0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
) STRICT;

INSERT INTO cosmetic_catalog_versions(
  catalog_version,catalog_id,activated_at,manifest_count,metadata_json
) VALUES(
  1,'preset-appearance-v1',CURRENT_TIMESTAMP,17,
  '{"slots":["appTheme","navigationSkin","workspaceBackdrop","profileTheme","profileLayout","profileBackdrop","avatarFrame","lobbyCard","matchCard","standingsRow","motionEffect"]}'
);

CREATE TABLE cosmetic_migration_receipts (
  profile_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  migration_id TEXT NOT NULL,
  catalog_version INTEGER NOT NULL REFERENCES cosmetic_catalog_versions(catalog_version),
  legacy_theme_id TEXT,
  legacy_frame_id TEXT,
  reset_slots_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(reset_slots_json) AND json_type(reset_slots_json)='array'),
  preserved_ownership INTEGER NOT NULL DEFAULT 1 CHECK (preserved_ownership=1),
  migrated_at TEXT NOT NULL
) STRICT;

INSERT OR IGNORE INTO player_cosmetics(player_id,slot,value_json)
SELECT player_id,'appTheme',value_json FROM player_cosmetics WHERE slot='theme';

INSERT OR IGNORE INTO player_cosmetics(player_id,slot,value_json)
SELECT player_id,'profileTheme',value_json FROM player_cosmetics WHERE slot='theme';

INSERT OR IGNORE INTO player_cosmetics(player_id,slot,value_json)
SELECT p.id,'profileLayout',json_quote(COALESCE(
  json_extract(p.extra_json,'$.profilePersonalization.skin'),
  'arena'
)) FROM players p;

INSERT OR IGNORE INTO player_cosmetics(player_id,slot,value_json)
SELECT p.id,'avatarFrame',json_quote(COALESCE(
  (SELECT json_extract(pc.value_json,'$') FROM player_cosmetics pc WHERE pc.player_id=p.id AND pc.slot='profileFrame'),
  (SELECT json_extract(pc.value_json,'$') FROM player_cosmetics pc WHERE pc.player_id=p.id AND pc.slot='cardFrame'),
  (SELECT json_extract(pc.value_json,'$') FROM player_cosmetics pc WHERE pc.player_id=p.id AND pc.slot='frame'),
  'default'
)) FROM players p;

INSERT OR IGNORE INTO player_cosmetics(player_id,slot,value_json)
SELECT p.id,slots.slot,json_quote('default')
FROM players p
CROSS JOIN (
  SELECT 'navigationSkin' AS slot UNION ALL SELECT 'workspaceBackdrop'
  UNION ALL SELECT 'profileBackdrop' UNION ALL SELECT 'lobbyCard'
  UNION ALL SELECT 'matchCard' UNION ALL SELECT 'standingsRow'
  UNION ALL SELECT 'motionEffect'
) slots;

INSERT OR IGNORE INTO player_cosmetics(player_id,slot,value_json)
SELECT p.id,'appTheme',json_quote('minimalist') FROM players p;

INSERT OR IGNORE INTO player_cosmetics(player_id,slot,value_json)
SELECT p.id,'profileTheme',json_quote('minimalist') FROM players p;

INSERT OR IGNORE INTO inventory_items(
  id,player_id,item_id,name_snapshot,item_type,quantity,purchased_at,extra_json
)
SELECT
  'migration42:' || p.id || ':match-card-classics',p.id,
  'preset-pack:match-card-classics','Classic Match Card Presets','cosmetic_preset_pack',1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),'{}'
FROM players p
WHERE EXISTS(SELECT 1 FROM inventory_items i WHERE i.player_id=p.id AND i.item_id='card_banner');

INSERT OR IGNORE INTO inventory_items(
  id,player_id,item_id,name_snapshot,item_type,quantity,purchased_at,extra_json
)
SELECT
  'migration42:' || p.id || ':lobby-card-classics',p.id,
  'preset-pack:lobby-card-classics','Classic Lobby Card Presets','cosmetic_preset_pack',1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),'{}'
FROM players p
WHERE EXISTS(SELECT 1 FROM inventory_items i WHERE i.player_id=p.id AND i.item_id='lobby_banner');

INSERT OR IGNORE INTO inventory_items(
  id,player_id,item_id,name_snapshot,item_type,quantity,purchased_at,extra_json
)
SELECT
  'migration42:' || p.id || ':profile-backdrop-classics',p.id,
  'preset-pack:profile-backdrop-classics','Classic Profile Backdrop Presets','cosmetic_preset_pack',1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),'{}'
FROM players p
WHERE EXISTS(SELECT 1 FROM inventory_items i WHERE i.player_id=p.id AND i.item_id='profile_banner');

INSERT INTO cosmetic_migration_receipts(
  profile_id,migration_id,catalog_version,legacy_theme_id,legacy_frame_id,
  reset_slots_json,preserved_ownership,migrated_at
)
SELECT
  p.id,'042_preset_appearance_system',1,
  COALESCE((SELECT json_extract(pc.value_json,'$') FROM player_cosmetics pc WHERE pc.player_id=p.id AND pc.slot='theme'),'minimalist'),
  COALESCE(
    (SELECT json_extract(pc.value_json,'$') FROM player_cosmetics pc WHERE pc.player_id=p.id AND pc.slot='profileFrame'),
    (SELECT json_extract(pc.value_json,'$') FROM player_cosmetics pc WHERE pc.player_id=p.id AND pc.slot='cardFrame'),
    (SELECT json_extract(pc.value_json,'$') FROM player_cosmetics pc WHERE pc.player_id=p.id AND pc.slot='frame')
  ),
  '["cardBanner","lobbyBanner","profileBanner"]',1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM players p
WHERE 1=1
ON CONFLICT(profile_id) DO NOTHING;

INSERT OR IGNORE INTO resource_reference_tombstones(
  reference_id,resource_hash,owner_type,owner_id,role,tombstoned_at,operation_id
)
SELECT
  rr.id,rr.resource_hash,rr.owner_type,rr.owner_id,rr.role,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),'migration42:dereference:' || rr.id
FROM resource_references rr
WHERE rr.deleted_at IS NULL
  AND rr.owner_id IN (SELECT id FROM players)
  AND rr.role IN (
    'cardBanner','lobbyBanner','profileBanner',
    'activeCosmetics.cardBanner','activeCosmetics.lobbyBanner','activeCosmetics.profileBanner'
  );

UPDATE resource_references
SET deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE deleted_at IS NULL
  AND owner_id IN (SELECT id FROM players)
  AND role IN (
    'cardBanner','lobbyBanner','profileBanner',
    'activeCosmetics.cardBanner','activeCosmetics.lobbyBanner','activeCosmetics.profileBanner'
  );

INSERT OR IGNORE INTO resource_gc_candidates(
  resource_hash,storage_path,reason,eligible_after,created_at
)
SELECT
  r.content_hash,r.storage_path,'migration42-unreferenced-cosmetic',
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM resources r
WHERE NOT EXISTS(
  SELECT 1 FROM resource_references rr
  WHERE rr.resource_hash=r.content_hash AND rr.deleted_at IS NULL
);

DELETE FROM player_cosmetics
WHERE slot IN (
  'theme','profileFrame','cardFrame','frame',
  'cardBanner','lobbyBanner','profileBanner'
);
`.trim();

export const migration042 = Object.freeze({
  id: '042_preset_appearance_system',
  description: 'Activate Road catalog v2 and migrate independent preset appearance slots without changing historical ownership.',
  sourceApplicationVersion: 'preset-appearance-v1',
  sql: PRESET_APPEARANCE_SCHEMA_SQL,
  checksum: 'd19c1e8905b5f7248a70ac54398ec5a77119393dfe1df44808a9f0513ce2fe83',
  // A short-lived development build registered this checksum before the
  // migration manifest was finalized. Its transaction completed successfully,
  // so existing local databases may safely treat it as the same applied step.
  compatibleChecksums: Object.freeze([
    '2f607ae3a6cfe592c99c1c9ec9a2459b31ccad1607adddcac53a3caa25d49a05',
    '7de5bb24a048ee2fdfcb442f1b18a629cb07f76b822c07a55f52983b9ea33fb4',
  ]),
});

export default migration042;
