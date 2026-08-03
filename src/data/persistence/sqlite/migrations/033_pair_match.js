export const PAIR_MATCH_SCHEMA_SQL = `
ALTER TABLE matches ADD COLUMN ruleset_id TEXT;
ALTER TABLE matches ADD COLUMN locked_at TEXT;
ALTER TABLE matches ADD COLUMN rules_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(rules_snapshot_json));
ALTER TABLE matches ADD COLUMN context_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context_snapshot_json));
ALTER TABLE matches ADD COLUMN legacy_rules_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(legacy_rules_json));

UPDATE matches
SET ruleset_id=COALESCE(
      json_extract(extra_json,'$.rulesSnapshot.rulesetId'),
      json_extract(extra_json,'$.rulesetId'),
      'legacy_configurable_v2'
    ),
    locked_at=json_extract(extra_json,'$.lockedAt'),
    rules_snapshot_json=COALESCE(json_extract(extra_json,'$.rulesSnapshot'),'{}'),
    context_snapshot_json=COALESCE(json_extract(extra_json,'$.contextSnapshot'),'{}'),
    legacy_rules_json=CASE
      WHEN COALESCE(
        json_extract(extra_json,'$.rulesSnapshot.rulesetId'),
        json_extract(extra_json,'$.rulesetId')
      )='pair_match_v1' THEN '{}'
      ELSE extra_json
    END;

CREATE INDEX matches_ruleset_status_idx
ON matches(ruleset_id,status,created_at DESC,id);

CREATE INDEX matches_lock_time_idx
ON matches(locked_at DESC,id)
WHERE locked_at IS NOT NULL;
`.trim();

export const migration033 = Object.freeze({
  id: '033_pair_match',
  description: 'Add the fixed Pair Match ruleset, lock boundary, privacy-safe context snapshot, and read-only legacy rules metadata.',
  sourceApplicationVersion: 'pair-match-v1',
  sql: PAIR_MATCH_SCHEMA_SQL,
  checksum: '1b853bef243fe08a779b06ca16facb01cd60ea85cc5881567cf78777537c3d97',
});

export default migration033;
