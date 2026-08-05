export const DEMO_AGENT_RESET_SQL = `
UPDATE document_players
SET record_json=json_set(
      record_json,
      '$.elo',0,
      '$.igtBaseElo',0,
      '$.tokens',0,
      '$.minutesClearedToday',0,
      '$.hasVisibleRating',json('false'),
      '$.achievements',json('{}'),
      '$.selectedAchievements',json('[]'),
      '$.selectedAchievementsV2',json('[]'),
      '$.stats',json('{}'),
      '$.updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      '$.syncUpdatedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE uuid='demo-player'
   OR lower(trim(COALESCE(json_extract(record_json,'$.username'),'')))='demo agent';

UPDATE players
SET elo=0,
    igt_base_elo=0,
    tokens=0,
    minutes_cleared_today=0,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent';

UPDATE document_tasks
SET record_json=json_set(
      record_json,
      '$.points',0,
      '$.pointsBase',0,
      '$.rewardBonusCoins',0,
      '$.rewardBonusContribution',0,
      '$.updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      '$.syncUpdatedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE COALESCE(
  json_extract(record_json,'$.parent'),
  json_extract(record_json,'$.playerUUID'),
  json_extract(record_json,'$.playerId')
) IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);

UPDATE tasks
SET points=0,points_base=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE player_id IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);

UPDATE document_contributions
SET record_json=json_set(
      record_json,
      '$.value',0,
      '$.rewardCoins',0,
      '$.updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      '$.syncUpdatedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE COALESCE(
  json_extract(record_json,'$.parent'),
  json_extract(record_json,'$.playerUUID'),
  json_extract(record_json,'$.playerId')
) IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);

UPDATE contributions
SET value=0,reward_coins=0
WHERE player_id IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);

UPDATE document_matches
SET record_json=json_set(
      record_json,
      '$.result.eloChange',0,
      '$.result.oldElo',0,
      '$.result.newElo',0,
      '$.result.playerEloChanges',json('{}'),
      '$.updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      '$.syncUpdatedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE COALESCE(
  json_extract(record_json,'$.parent'),
  json_extract(record_json,'$.playerUUID'),
  json_extract(record_json,'$.playerId')
) IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);

UPDATE match_participants
SET elo_at_match=0,elo_delta=0
WHERE player_id IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);

UPDATE match_elo_receipts
SET old_elo=0,new_elo=0,delta=0
WHERE player_id IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);

DELETE FROM document_achievement_receipts
WHERE COALESCE(
  json_extract(record_json,'$.parent'),
  json_extract(record_json,'$.playerUUID'),
  json_extract(record_json,'$.playerId'),
  json_extract(record_json,'$.playerKey')
) IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);
DELETE FROM document_achievement_events
WHERE COALESCE(
  json_extract(record_json,'$.parent'),
  json_extract(record_json,'$.playerUUID'),
  json_extract(record_json,'$.playerId'),
  json_extract(record_json,'$.playerKey')
) IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);
DELETE FROM document_achievement_states
WHERE COALESCE(
  json_extract(record_json,'$.parent'),
  json_extract(record_json,'$.playerUUID'),
  json_extract(record_json,'$.playerId'),
  json_extract(record_json,'$.playerKey'),
  uuid
) IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);

DELETE FROM achievement_receipts
WHERE player_id IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);
DELETE FROM achievement_events
WHERE player_id IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);
DELETE FROM achievement_states
WHERE player_id IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);
DELETE FROM achievement_v2_progress
WHERE profile_id IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);
DELETE FROM achievement_evidence_receipts
WHERE profile_id IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);
DELETE FROM achievement_legacy_awards
WHERE profile_id IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);
DELETE FROM achievement_records
WHERE profile_id IN (
  SELECT id FROM players WHERE id='demo-player' OR lower(trim(COALESCE(username,'')))='demo agent'
);

UPDATE economy
SET global_money_minor=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE singleton_id=1;

UPDATE document_app_settings
SET record_json=json_set(
      record_json,
      '$.value.globalMoney',0,
      '$.updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE uuid='__tapestry_compact_economy_state__';

UPDATE derived_cache_entries
SET invalidated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE invalidated_at IS NULL;

PRAGMA optimize;
`.trim();

export const migration057 = Object.freeze({
  id: '057_demo_agent_reset',
  description: 'Reset the persisted Demo Agent rating, score metrics, achievements, and application money without touching user profiles.',
  sourceApplicationVersion: 'demo-agent-reset-v1',
  sql: DEMO_AGENT_RESET_SQL,
  checksum: '6b8162b3e369b1757b5101a4dc0a6e12d429375c6e6d2ef5eade409f3d4b9abe',
});

export default migration057;
