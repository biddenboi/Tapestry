import { REFERENCE_CAPTURE_TARGETS } from './052_durable_reference_capture.js';

function triggerName(table, event) {
  const suffix = table.replace('document_', '');
  return `sync_reference_${suffix}_${event.toLowerCase()}`;
}

function putCaptureTrigger(recordType, store, table, event) {
  const name = triggerName(table, event);
  return `DROP TRIGGER IF EXISTS ${name};
CREATE TRIGGER ${name}
AFTER ${event} ON ${table}
WHEN COALESCE((SELECT enabled FROM sync_reference_capture_state WHERE singleton_id=1),1)=1
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
  const name = triggerName(table, 'delete');
  // A device clock can be behind the timestamp carried by a record restored
  // from another client. A local delete is causally newer than the row it
  // removes, so its tombstone must be at least one millisecond newer instead
  // of losing forever to that future-dated record on the server.
  const deletedAt = `CASE
      WHEN COALESCE(json_extract(OLD.record_json,'$.syncUpdatedAt'),'') >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
      THEN strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(OLD.record_json,'$.syncUpdatedAt'),'+0.001 seconds')
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now')
    END`;
  return `DROP TRIGGER IF EXISTS ${name};
CREATE TRIGGER ${name}
AFTER DELETE ON ${table}
WHEN COALESCE((SELECT enabled FROM sync_reference_capture_state WHERE singleton_id=1),1)=1
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
      'deletedAt',${deletedAt},
      'syncUpdatedAt',${deletedAt}
    ),
    1,${deletedAt},'pending',0,NULL,NULL,
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

export const REMOTE_REFERENCE_CAPTURE_GUARD_SQL = [
  `CREATE TABLE IF NOT EXISTS sync_reference_capture_state (
    singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    updated_at TEXT NOT NULL
  );`,
  `INSERT INTO sync_reference_capture_state(singleton_id,enabled,updated_at)
   VALUES(1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   ON CONFLICT(singleton_id) DO UPDATE SET enabled=1,updated_at=excluded.updated_at;`,
  ...REFERENCE_CAPTURE_TARGETS.flatMap(([recordType, store, table]) => [
    putCaptureTrigger(recordType, store, table, 'INSERT'),
    putCaptureTrigger(recordType, store, table, 'UPDATE'),
    deleteCaptureTrigger(recordType, store, table),
  ]),
  'PRAGMA optimize;',
].join('\n\n').trim();

export const migration053 = Object.freeze({
  id: '053_remote_reference_capture_guard',
  description: 'Prevent remotely applied reference records from echoing into the local upload outbox.',
  sourceApplicationVersion: 'sync-convergence-v3',
  sql: REMOTE_REFERENCE_CAPTURE_GUARD_SQL,
  checksum: 'bb240b79bf091cf250144ef87521111c919683d279a74a1a61855b158b14cfe0',
});

export default migration053;
