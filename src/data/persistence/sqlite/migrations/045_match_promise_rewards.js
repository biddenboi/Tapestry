export const MATCH_PROMISE_REWARDS_SQL = `
ALTER TABLE action_sessions ADD COLUMN match_reward_policy_version INTEGER;
ALTER TABLE action_sessions ADD COLUMN match_reward_contract_json TEXT
  CHECK (match_reward_contract_json IS NULL OR json_valid(match_reward_contract_json));
ALTER TABLE action_sessions ADD COLUMN match_score_finalized_at TEXT;
ALTER TABLE action_sessions ADD COLUMN match_score_event_id TEXT;
ALTER TABLE action_sessions ADD COLUMN match_score_breakdown_json TEXT
  CHECK (match_score_breakdown_json IS NULL OR json_valid(match_score_breakdown_json));

UPDATE action_sessions
SET match_reward_policy_version=(
      SELECT CAST(json_extract(d.record_json,'$.matchRewardContract.policyVersion') AS INTEGER)
      FROM document_action_sessions d WHERE d.uuid=action_sessions.id
    ),
    match_reward_contract_json=(
      SELECT json_extract(d.record_json,'$.matchRewardContract')
      FROM document_action_sessions d WHERE d.uuid=action_sessions.id
    ),
    match_score_finalized_at=(
      SELECT json_extract(d.record_json,'$.matchScoreFinalizedAt')
      FROM document_action_sessions d WHERE d.uuid=action_sessions.id
    ),
    match_score_event_id=(
      SELECT json_extract(d.record_json,'$.matchScoreEventUUID')
      FROM document_action_sessions d WHERE d.uuid=action_sessions.id
    ),
    match_score_breakdown_json=(
      SELECT json_extract(d.record_json,'$.matchScoreBreakdown')
      FROM document_action_sessions d WHERE d.uuid=action_sessions.id
    )
WHERE EXISTS(SELECT 1 FROM document_action_sessions d WHERE d.uuid=action_sessions.id);

CREATE UNIQUE INDEX action_sessions_match_score_event_idx
ON action_sessions(match_score_event_id) WHERE match_score_event_id IS NOT NULL;
`.trim();

export const migration045 = Object.freeze({
  id: '045_match_promise_rewards',
  description: 'Persist versioned Match promise contracts and immutable boundary score finalization evidence.',
  sourceApplicationVersion: 'match-promise-v1',
  sql: MATCH_PROMISE_REWARDS_SQL,
  checksum: 'd063cdd6328a44b5b1276e34a62917733e1103ad9df0a63d046a038e34ad4b6e',
});

export default migration045;
