const REFERENCE_CAPTURE_TARGETS = Object.freeze([
  ['profile', 'players', 'document_players'],
  ['goal', 'projects', 'document_projects'],
  ['goal-area', 'goalAreas', 'document_goal_areas'],
  ['goal-milestone', 'goalMilestones', 'document_goal_milestones'],
  ['goal-update', 'goalUpdates', 'document_goal_updates'],
  ['goal-link', 'goalLinks', 'document_goal_links'],
  ['goal-participant', 'goalParticipants', 'document_goal_participants'],
  ['goal-contribution', 'contributions', 'document_contributions'],
  ['task', 'todos', 'document_todos'],
  ['completed-task', 'tasks', 'document_tasks'],
  ['task-completion-event', 'taskCompletionEvents', 'document_task_completion_events'],
  ['task-completion-receipt', 'taskCompletionReceipts', 'document_task_completion_receipts'],
  ['reminder', 'reminders', 'document_reminders'],
  ['action-plan', 'actionPlans', 'document_action_plans'],
  ['action-session', 'actionSessions', 'document_action_sessions'],
  ['handoff', 'handoffs', 'document_handoffs'],
  ['match', 'matches', 'document_matches'],
  ['match-score-event', 'matchScoreEvents', 'document_match_score_events'],
  ['reward-provenance', 'rewardProvenance', 'document_reward_provenance'],
  ['world-consequence-receipt', 'worldConsequenceReceipts', 'document_world_consequence_receipts'],
  ['shop-catalog', 'shop', 'document_shop'],
  ['inventory', 'inventory', 'document_inventory'],
  ['transaction', 'transactions', 'document_transactions'],
  ['journal', 'journals', 'document_journals'],
  ['chronicle-entry-metadata', 'chronicleEntryMetadata', 'document_chronicle_entry_metadata'],
  ['chronicle-entry-revision', 'chronicleEntryRevisions', 'document_chronicle_entry_revisions'],
  ['chronicle-entry-access', 'chronicleEntryAccess', 'document_chronicle_entry_access'],
  ['chronicle-story', 'chronicleStories', 'document_chronicle_stories'],
  ['chronicle-story-entry', 'chronicleStoryEntries', 'document_chronicle_story_entries'],
  ['chronicle-entry-link', 'chronicleEntryLinks', 'document_chronicle_entry_links'],
  ['chronicle-reaction', 'chronicleReactions', 'document_chronicle_reactions'],
  ['event', 'events', 'document_events'],
  ['event-log', 'eventLogs', 'document_event_logs'],
  ['event-buff', 'eventBuffs', 'document_event_buffs'],
  ['achievement-event', 'achievementEvents', 'document_achievement_events'],
  ['achievement-state', 'achievementStates', 'document_achievement_states'],
  ['achievement-receipt', 'achievementReceipts', 'document_achievement_receipts'],
  ['friendship', 'friendships', 'document_friendships'],
  ['notification', 'notifications', 'document_notifications'],
]);

function putCaptureTrigger(recordType, store, table, event) {
  const suffix = table.replace('document_', '');
  return `CREATE TRIGGER sync_reference_${suffix}_${event.toLowerCase()}
AFTER ${event} ON ${table}
BEGIN
  INSERT INTO sync_reference_outbox(
    record_type,record_id,store_name,player_id,workspace_id,payload_json,
    deleted,updated_at,status,attempt_count,last_error_code,last_error_message,created_at
  ) VALUES(
    '${recordType}',NEW.uuid,'${store}',
    COALESCE(json_extract(NEW.record_json,'$.parent'),json_extract(NEW.record_json,'$.playerUUID'),json_extract(NEW.record_json,'$.playerId')),
    json_extract(NEW.record_json,'$.workspaceId'),NEW.record_json,0,
    COALESCE(
      json_extract(NEW.record_json,'$.syncUpdatedAt'),
      strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ),
    'pending',0,NULL,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now')
  )
  ON CONFLICT(record_type,record_id) DO UPDATE SET
    store_name=excluded.store_name,
    player_id=excluded.player_id,
    workspace_id=excluded.workspace_id,
    payload_json=excluded.payload_json,
    deleted=0,
    updated_at=excluded.updated_at,
    status='pending',
    last_error_code=NULL,
    last_error_message=NULL
  WHERE excluded.updated_at>=sync_reference_outbox.updated_at;
END;`;
}

function deleteCaptureTrigger(recordType, store, table) {
  const suffix = table.replace('document_', '');
  return `CREATE TRIGGER sync_reference_${suffix}_delete
AFTER DELETE ON ${table}
BEGIN
  INSERT INTO sync_reference_outbox(
    record_type,record_id,store_name,player_id,workspace_id,payload_json,
    deleted,updated_at,status,attempt_count,last_error_code,last_error_message,created_at
  ) VALUES(
    '${recordType}',OLD.uuid,'${store}',
    COALESCE(json_extract(OLD.record_json,'$.parent'),json_extract(OLD.record_json,'$.playerUUID'),json_extract(OLD.record_json,'$.playerId')),
    json_extract(OLD.record_json,'$.workspaceId'),
    json_object(
      'UUID',OLD.uuid,
      '__deleted',json('true'),
      'deletedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      'syncUpdatedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ),
    1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'pending',0,NULL,NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ','now')
  )
  ON CONFLICT(record_type,record_id) DO UPDATE SET
    store_name=excluded.store_name,
    player_id=excluded.player_id,
    workspace_id=excluded.workspace_id,
    payload_json=excluded.payload_json,
    deleted=1,
    updated_at=excluded.updated_at,
    status='pending',
    last_error_code=NULL,
    last_error_message=NULL;
END;`;
}

export const DURABLE_REFERENCE_CAPTURE_SQL = [
  ...REFERENCE_CAPTURE_TARGETS.flatMap(([recordType, store, table]) => [
    putCaptureTrigger(recordType, store, table, 'INSERT'),
    putCaptureTrigger(recordType, store, table, 'UPDATE'),
    deleteCaptureTrigger(recordType, store, table),
  ]),
  'PRAGMA optimize;',
].join('\n\n').trim();

export const migration052 = Object.freeze({
  id: '052_durable_reference_capture',
  description: 'Capture every mobile-safe canonical document mutation in the durable cloud outbox.',
  sourceApplicationVersion: 'durable-cloud-sync-v2',
  sql: DURABLE_REFERENCE_CAPTURE_SQL,
  checksum: '430a2adf5b33f7da78ba14e5b73730018dcf07d970307bf5f85395da899bfc56',
});

export default migration052;
