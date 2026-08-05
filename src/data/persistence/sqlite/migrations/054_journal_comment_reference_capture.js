const RECORD_TYPE = 'journal-comment';
const STORE = 'journalComments';
const TABLE = 'document_journal_comments';

function putTrigger(event) {
  const name = `sync_reference_journal_comments_${event.toLowerCase()}`;
  return `DROP TRIGGER IF EXISTS ${name};
CREATE TRIGGER ${name}
AFTER ${event} ON ${TABLE}
WHEN COALESCE((SELECT enabled FROM sync_reference_capture_state WHERE singleton_id=1),1)=1
BEGIN
  INSERT INTO sync_reference_outbox(
    record_type,record_id,store_name,player_id,workspace_id,payload_json,
    deleted,updated_at,status,attempt_count,last_error_code,last_error_message,created_at
  ) VALUES(
    '${RECORD_TYPE}',NEW.uuid,'${STORE}',
    COALESCE(json_extract(NEW.record_json,'$.authorUUID'),json_extract(NEW.record_json,'$.parent')),
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

const deleteTrigger = `DROP TRIGGER IF EXISTS sync_reference_journal_comments_delete;
CREATE TRIGGER sync_reference_journal_comments_delete
AFTER DELETE ON ${TABLE}
WHEN COALESCE((SELECT enabled FROM sync_reference_capture_state WHERE singleton_id=1),1)=1
BEGIN
  INSERT INTO sync_reference_outbox(
    record_type,record_id,store_name,player_id,workspace_id,payload_json,
    deleted,updated_at,status,attempt_count,last_error_code,last_error_message,created_at
  ) VALUES(
    '${RECORD_TYPE}',OLD.uuid,'${STORE}',
    COALESCE(json_extract(OLD.record_json,'$.authorUUID'),json_extract(OLD.record_json,'$.parent')),
    NULL,
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
    payload_json=excluded.payload_json,
    deleted=1,
    updated_at=excluded.updated_at,
    status='pending',
    last_error_code=NULL,
    last_error_message=NULL;
END;`;

export const JOURNAL_COMMENT_REFERENCE_CAPTURE_SQL = [
  putTrigger('INSERT'),
  putTrigger('UPDATE'),
  deleteTrigger,
  'PRAGMA optimize;',
].join('\n\n').trim();

export const migration054 = Object.freeze({
  id: '054_journal_comment_reference_capture',
  description: 'Capture comment creates, edits, and deletes in the durable mobile reference outbox.',
  sourceApplicationVersion: 'mobile-social-convergence-v1',
  sql: JOURNAL_COMMENT_REFERENCE_CAPTURE_SQL,
  checksum: 'bb4f2197d29874af1071023a25f06c96b2cffb65a69dd4736908a605e9e9e67f',
});

export default migration054;
