// Frozen compatibility rules: do not import the mutable runtime sanitizer here.
const RETIRED_JSON_KEYS = [
  "dojoSessionUUID",
  "sourceDojoSessionUUID",
  "dojoContribution",
  "dojoMomentum",
  "dojoMomentumByPlayer",
  "dojoSessions",
  "bestDojoSessionPoints",
  "dojoSessionPointsByDay",
  "presenceVisibilityPolicy",
  "worldLocationId",
  "latitude",
  "longitude",
  "locationAccuracy",
  "locationCapturedAt",
  "location_accuracy",
  "location_captured_at",
  "peace_1",
  "peace_2",
  "peace_3"
];
const DOCUMENT_TABLES = [
  "document_achievement_events",
  "document_achievement_receipts",
  "document_achievement_states",
  "document_action_plans",
  "document_action_sessions",
  "document_analytics_events",
  "document_app_settings",
  "document_background_job_receipts",
  "document_background_jobs",
  "document_chronicle_collaboration_outbox",
  "document_chronicle_drafts",
  "document_chronicle_entry_access",
  "document_chronicle_entry_conflicts",
  "document_chronicle_entry_links",
  "document_chronicle_entry_metadata",
  "document_chronicle_entry_operation_receipts",
  "document_chronicle_entry_revisions",
  "document_chronicle_feed_view_states",
  "document_chronicle_legacy_note_mappings",
  "document_chronicle_reactions",
  "document_chronicle_resurface_states",
  "document_chronicle_stories",
  "document_chronicle_story_entries",
  "document_chronicle_story_read_states",
  "document_contribution_road_choices",
  "document_contribution_road_migrations",
  "document_contribution_road_stats",
  "document_contribution_road_unlocks",
  "document_contributions",
  "document_custom_events",
  "document_derived_caches",
  "document_event_buffs",
  "document_event_logs",
  "document_events",
  "document_friendships",
  "document_goal_areas",
  "document_goal_links",
  "document_goal_milestones",
  "document_goal_participants",
  "document_goal_updates",
  "document_handoffs",
  "document_interface_reveal_receipts",
  "document_intervention_decisions",
  "document_inventory",
  "document_journal_comments",
  "document_journals",
  "document_match_score_events",
  "document_matches",
  "document_next_move_decisions",
  "document_next_move_feedback",
  "document_next_move_surface_preferences",
  "document_notes",
  "document_notifications",
  "document_players",
  "document_profile_context_audit",
  "document_profile_context_items",
  "document_profile_context_preferences",
  "document_profile_context_recipients",
  "document_profile_context_suggestions",
  "document_profile_summaries",
  "document_projects",
  "document_reminders",
  "document_resources",
  "document_reward_provenance",
  "document_rhythm_definitions",
  "document_rhythm_opportunities",
  "document_shop",
  "document_task_completion_events",
  "document_task_completion_receipts",
  "document_task_plan_receipts",
  "document_task_recommendations",
  "document_tasks",
  "document_todos",
  "document_transactions",
  "document_world_consequence_receipts"
];
const TYPED_JSON_COLUMNS = [
  [
    "achievement_events",
    "payload_json"
  ],
  [
    "achievement_process_commands",
    "counters_json"
  ],
  [
    "achievement_process_commands",
    "event_awards_json"
  ],
  [
    "achievement_process_commands",
    "earned_keys_json"
  ],
  [
    "achievement_process_commands",
    "removed_keys_json"
  ],
  [
    "achievement_receipts",
    "earned_keys_json"
  ],
  [
    "achievement_receipts",
    "removed_keys_json"
  ],
  [
    "achievement_receipts",
    "issued_keys_json"
  ],
  [
    "achievement_records",
    "value_json"
  ],
  [
    "achievement_states",
    "counters_json"
  ],
  [
    "achievement_states",
    "event_awards_json"
  ],
  [
    "analytics_events",
    "metadata_json"
  ],
  [
    "background_job_receipts",
    "outcome_json"
  ],
  [
    "background_jobs",
    "payload_json"
  ],
  [
    "chronicle_retrospective_dialogue",
    "metadata_json"
  ],
  [
    "contribution_road_catalog_versions",
    "metadata_json"
  ],
  [
    "contributions",
    "extra_json"
  ],
  [
    "cosmetic_catalog_versions",
    "metadata_json"
  ],
  [
    "custom_events",
    "extra_json"
  ],
  [
    "derived_cache_entries",
    "payload_json"
  ],
  [
    "event_buffs",
    "extra_json"
  ],
  [
    "event_logs",
    "extra_json"
  ],
  [
    "friendship_accept_commands",
    "metadata_json"
  ],
  [
    "friendship_request_commands",
    "metadata_json"
  ],
  [
    "friendships",
    "metadata_json"
  ],
  [
    "inventory_items",
    "extra_json"
  ],
  [
    "journal_comments",
    "extra_json"
  ],
  [
    "journals",
    "extra_json"
  ],
  [
    "lifecycle_events",
    "extra_json"
  ],
  [
    "match_participants",
    "metadata_json"
  ],
  [
    "matches",
    "result_json"
  ],
  [
    "matches",
    "extra_json"
  ],
  [
    "next_move_feedback",
    "payload_json"
  ],
  [
    "note_conflicts",
    "metadata_json"
  ],
  [
    "notes",
    "extra_json"
  ],
  [
    "notifications",
    "metadata_json"
  ],
  [
    "player_cosmetics",
    "value_json"
  ],
  [
    "player_titles",
    "metadata_json"
  ],
  [
    "players",
    "extra_json"
  ],
  [
    "post_match_commands",
    "outcome_json"
  ],
  [
    "profile_context_audit",
    "metadata_json"
  ],
  [
    "projects",
    "extra_json"
  ],
  [
    "purchase_batches",
    "metadata_json"
  ],
  [
    "purchase_commands",
    "metadata_json"
  ],
  [
    "purchase_ledger",
    "metadata_json"
  ],
  [
    "reminders",
    "extra_json"
  ],
  [
    "resource_file_ops",
    "metadata_json"
  ],
  [
    "resource_references",
    "metadata_json"
  ],
  [
    "resources",
    "metadata_json"
  ],
  [
    "runtime_command_receipts",
    "result_json"
  ],
  [
    "settings",
    "value_json"
  ],
  [
    "settings",
    "extra_json"
  ],
  [
    "shop_items",
    "extra_json"
  ],
  [
    "sync_conflicts",
    "local_payload_json"
  ],
  [
    "sync_conflicts",
    "server_payload_json"
  ],
  [
    "sync_operations",
    "payload_json"
  ],
  [
    "sync_reference_meta",
    "value_json"
  ],
  [
    "sync_reference_outbox",
    "payload_json"
  ],
  [
    "tasks",
    "extra_json"
  ],
  [
    "todos",
    "extra_json"
  ]
];

const retiredKeysSql = RETIRED_JSON_KEYS.map((key) => "'" + key + "'").join(',');
const matchesRetiredJson = (column) => `(
  key IN (${retiredKeysSql})
  OR (type='text' AND value IN ('peace_1','peace_2','peace_3'))
  OR (key IN ('source','gameState') AND value='dojo')
  OR (key IN ('audience','defaultAudience','sourceVisibility') AND value IN ('fellows','cast'))
  OR (key='location' AND type='object' AND
      (json_type(value,'$.latitude') IS NOT NULL OR json_type(value,'$.longitude') IS NOT NULL))
)`;

function scrubJsonSql(table, column, { document = false } = {}) {
  const cleaned = `(
    WITH RECURSIVE patches AS (
      SELECT row_number() OVER (ORDER BY id DESC) AS n,fullkey AS path,
             CASE WHEN key='source' AND value='dojo' THEN 'manual'
                  WHEN key='gameState' AND value='dojo' THEN 'idle'
                  WHEN key IN ('audience','defaultAudience','sourceVisibility') AND value='cast' THEN 'collaborators'
                  WHEN key IN ('audience','defaultAudience','sourceVisibility') AND value='fellows' THEN 'private'
                  ELSE NULL END AS replacement
      FROM json_tree(record.${column}) WHERE ${matchesRetiredJson(column)}
    ), clean(n,doc) AS (
      SELECT 0,record.${column}
      UNION ALL
      SELECT clean.n+1,CASE WHEN patches.replacement IS NULL
        THEN json_remove(clean.doc,patches.path)
        ELSE json_set(clean.doc,patches.path,patches.replacement) END
      FROM clean JOIN patches ON patches.n=clean.n+1
    )
    SELECT doc FROM clean ORDER BY n DESC LIMIT 1
  )`;
  return `UPDATE ${table} AS record
SET ${column}=${document ? "json_set(" + cleaned + ",'$.syncUpdatedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'))" : cleaned}
WHERE ${column} IS NOT NULL AND EXISTS (
  SELECT 1 FROM json_tree(record.${column}) WHERE ${matchesRetiredJson(column)}
);`;
}
export const REMOVE_DOJO_SOCIAL_WORLD_SQL = `
DROP TRIGGER IF EXISTS social_activity_elo_insert_dirty;
DROP TRIGGER IF EXISTS social_activity_match_insert_dirty;
DROP TRIGGER IF EXISTS social_activity_match_update_dirty;
DROP TRIGGER IF EXISTS social_activity_participant_insert_dirty;
DROP TRIGGER IF EXISTS social_activity_participant_update_dirty;
DROP TRIGGER IF EXISTS social_activity_player_delete_cleanup;
DROP TRIGGER IF EXISTS social_activity_presence_delete_dirty;
DROP TRIGGER IF EXISTS social_activity_presence_insert_dirty;
DROP TRIGGER IF EXISTS social_activity_presence_update_dirty;
DROP TRIGGER IF EXISTS social_activity_project_delete_dirty;
DROP TRIGGER IF EXISTS social_activity_project_insert_dirty;
DROP TRIGGER IF EXISTS social_activity_project_update_dirty;
DROP TRIGGER IF EXISTS social_activity_task_delete_dirty;
DROP TRIGGER IF EXISTS social_activity_task_insert_dirty;
DROP TRIGGER IF EXISTS social_activity_task_update_dirty;
DROP TRIGGER IF EXISTS social_activity_todo_delete_dirty;
DROP TRIGGER IF EXISTS social_activity_todo_insert_dirty;
DROP TRIGGER IF EXISTS social_activity_todo_update_dirty;
DROP TRIGGER IF EXISTS social_cast_assignment_validate_eligibility;
DROP TRIGGER IF EXISTS social_cast_friend_accept_evict;
DROP TRIGGER IF EXISTS social_cast_friend_insert_evict;
DROP TRIGGER IF EXISTS social_cast_unavailable_profile_evict;
DROP TABLE IF EXISTS dojo_session_ranks;
DROP TABLE IF EXISTS dojo_session_rollups;
DROP TABLE IF EXISTS social_event_receipts;
DROP TABLE IF EXISTS social_encounters;
DROP TABLE IF EXISTS social_activity_index;
DROP TABLE IF EXISTS social_activity_dirty_subjects;
DROP TABLE IF EXISTS social_activity_rebuild_state;
DROP TABLE IF EXISTS social_cast_assignments;
DROP TABLE IF EXISTS social_cast_reviews;
DROP TABLE IF EXISTS semantic_presence_intervals;
DROP VIEW IF EXISTS friend_residency;
DROP VIEW IF EXISTS event_map_points;
DROP INDEX IF EXISTS tasks_cast_history_igt_idx;
DROP INDEX IF EXISTS lifecycle_events_location_idx;
DROP INDEX IF EXISTS event_logs_location_idx;
ALTER TABLE lifecycle_events DROP COLUMN latitude;
ALTER TABLE lifecycle_events DROP COLUMN longitude;
ALTER TABLE lifecycle_events DROP COLUMN location_accuracy;
ALTER TABLE lifecycle_events DROP COLUMN location_captured_at;
ALTER TABLE event_logs DROP COLUMN latitude;
ALTER TABLE event_logs DROP COLUMN longitude;
ALTER TABLE event_logs DROP COLUMN location_accuracy;
ALTER TABLE contributions DROP COLUMN latitude;
ALTER TABLE contributions DROP COLUMN longitude;
ALTER TABLE action_sessions DROP COLUMN dojo_session_id;


-- Document deletions deliberately retain sync-capture triggers, producing
-- durable cloud tombstones. Scrubbed shared records also re-enter the outbox.
${DOCUMENT_TABLES.map((table) => `DELETE FROM ${table}
WHERE uuid='special-dojo-multiplier' OR uuid LIKE 'dojoLeaderboardSnapshot:%'
   OR json_extract(record_json,'$.eventUUID')='special-dojo-multiplier'
   OR json_extract(record_json,'$.specialKind')='dojo_multiplier'
   OR json_extract(record_json,'$.type')='match-dojo-effects';`).join('\n')}
DELETE FROM event_buffs WHERE event_id='special-dojo-multiplier';
DELETE FROM event_logs WHERE event_id='special-dojo-multiplier';
DELETE FROM custom_events WHERE id='special-dojo-multiplier' OR special_kind='dojo_multiplier';
DELETE FROM settings WHERE id LIKE 'dojoLeaderboardSnapshot:%';
DELETE FROM achievement_legacy_awards WHERE legacy_key IN ('peace_1','peace_2','peace_3');
DELETE FROM background_job_receipts WHERE job_id IN (SELECT id FROM background_jobs WHERE job_type='match-dojo-effects');
DELETE FROM background_jobs WHERE job_type='match-dojo-effects';
DELETE FROM derived_cache_entries WHERE cache_kind LIKE '%dojo%' OR cache_kind LIKE '%social-world%';
DELETE FROM source_versions WHERE source_key IN ('presence','socialWorld','socialActivity','encounters','dojoStandings','dojoRanks');
DELETE FROM runtime_command_receipts
WHERE command_label LIKE 'social-world-%' OR command_label LIKE 'social-cast-%'
   OR command_label LIKE 'social-encounter-%' OR command_label LIKE 'dojo-%';
UPDATE tasks SET source='manual' WHERE source='dojo';
UPDATE contributions SET source='manual' WHERE source='dojo';
UPDATE sync_reference_outbox SET payload_json='{}',deleted=1,status='pending',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE deleted=0 AND (record_id='special-dojo-multiplier'
  OR json_extract(payload_json,'$.eventUUID')='special-dojo-multiplier'
  OR json_extract(payload_json,'$.specialKind')='dojo_multiplier');

${DOCUMENT_TABLES.map((table) => scrubJsonSql(table,'record_json',{ document: true })).join('\n\n')}
${TYPED_JSON_COLUMNS.map(([table,column]) => scrubJsonSql(table,column)).join('\n\n')}

PRAGMA optimize;
`.trim();

export const migration059 = Object.freeze({
  id: '059_remove_dojo_social_world',
  description: 'Retire Dojo, social-world projections, presence tracking, and map coordinates.',
  sourceApplicationVersion: 'remove-dojo-social-world',
  sql: REMOVE_DOJO_SOCIAL_WORLD_SQL,
  checksum: '8606f0eb9718c2df97b82f6d5ae02c2fbd8f9ccfc5fb9e1e8eba4fcbbad9b0e8',
});

export default migration059;
