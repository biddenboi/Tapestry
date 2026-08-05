const TARGETS = Object.freeze([
  ['custom-event', 'customEvents', 'document_custom_events'],
  ['rhythm-definition', 'rhythmDefinitions', 'document_rhythm_definitions'],
  ['rhythm-opportunity', 'rhythmOpportunities', 'document_rhythm_opportunities'],
]);

function triggerName(table, event) {
  return `sync_reference_${table.replace('document_', '')}_${event.toLowerCase()}`;
}

function putTrigger(recordType, store, table, event) {
  return `DROP TRIGGER IF EXISTS ${triggerName(table, event)};
CREATE TRIGGER ${triggerName(table, event)}
AFTER ${event} ON ${table}
WHEN COALESCE((SELECT enabled FROM sync_reference_capture_state WHERE singleton_id=1),1)=1
BEGIN
  INSERT INTO sync_reference_outbox(
    record_type,record_id,store_name,player_id,workspace_id,payload_json,
    deleted,updated_at,status,attempt_count,last_error_code,last_error_message,created_at
  ) VALUES(
    '${recordType}',NEW.uuid,'${store}',
    COALESCE(json_extract(NEW.record_json,'$.parent'),json_extract(NEW.record_json,'$.ownerUUID')),
    NULL,NEW.record_json,0,
    COALESCE(
      json_extract(NEW.record_json,'$.syncUpdatedAt'),
      json_extract(NEW.record_json,'$.updatedAt'),
      json_extract(NEW.record_json,'$.createdAt'),
      strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ),
    'pending',0,NULL,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now')
  )
  ON CONFLICT(record_type,record_id) DO UPDATE SET
    store_name=excluded.store_name,
    player_id=excluded.player_id,
    payload_json=excluded.payload_json,
    deleted=0,
    updated_at=excluded.updated_at,
    status='pending',
    last_error_code=NULL,
    last_error_message=NULL
  WHERE excluded.updated_at>=sync_reference_outbox.updated_at;
END;`;
}

function deleteTrigger(recordType, store, table) {
  const deletedAt = `CASE
      WHEN COALESCE(json_extract(OLD.record_json,'$.syncUpdatedAt'),'') >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
      THEN strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(OLD.record_json,'$.syncUpdatedAt'),'+0.001 seconds')
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now')
    END`;
  return `DROP TRIGGER IF EXISTS ${triggerName(table, 'delete')};
CREATE TRIGGER ${triggerName(table, 'delete')}
AFTER DELETE ON ${table}
WHEN COALESCE((SELECT enabled FROM sync_reference_capture_state WHERE singleton_id=1),1)=1
BEGIN
  INSERT INTO sync_reference_outbox(
    record_type,record_id,store_name,player_id,workspace_id,payload_json,
    deleted,updated_at,status,attempt_count,last_error_code,last_error_message,created_at
  ) VALUES(
    '${recordType}',OLD.uuid,'${store}',
    COALESCE(json_extract(OLD.record_json,'$.parent'),json_extract(OLD.record_json,'$.ownerUUID')),
    NULL,
    json_object(
      'UUID',OLD.uuid,
      '__deleted',json('true'),
      'deletedAt',${deletedAt},
      'syncUpdatedAt',${deletedAt}
    ),
    1,${deletedAt},'pending',0,NULL,NULL,
    strftime('%Y-%m-%dT%H:%M:%fZ','now')
  )
  ON CONFLICT(record_type,record_id) DO UPDATE SET
    store_name=excluded.store_name,
    player_id=excluded.player_id,
    payload_json=excluded.payload_json,
    deleted=1,
    updated_at=excluded.updated_at,
    status='pending',
    last_error_code=NULL,
    last_error_message=NULL;
END;`;
}

export const HABIT_REFERENCE_CAPTURE_SQL = [
  ...TARGETS.flatMap(([recordType, store, table]) => [
    putTrigger(recordType, store, table, 'INSERT'),
    putTrigger(recordType, store, table, 'UPDATE'),
    deleteTrigger(recordType, store, table),
  ]),
  'PRAGMA optimize;',
].join('\n\n').trim();

export const migration055 = Object.freeze({
  id: '055_habit_reference_capture',
  description: 'Capture Habit definitions, Rhythms, opportunities, and their deletions in the durable cloud outbox.',
  sourceApplicationVersion: 'mobile-habits-convergence-v1',
  sql: HABIT_REFERENCE_CAPTURE_SQL,
  checksum: 'd985faa4745667debde15289ab99fb4f6c8693d7c315d773fab7e52d941aa4a8',
});

export default migration055;
