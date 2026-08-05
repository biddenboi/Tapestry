const RECORD_TYPE = 'ml-model';
const STORE = 'appSettings';
const TABLE = 'document_app_settings';
const UUID_PREFIX = 'task-recommender-v12-';

function putTrigger(event) {
  const suffix = event.toLowerCase();
  return `DROP TRIGGER IF EXISTS sync_reference_mobile_ml_model_${suffix};
CREATE TRIGGER sync_reference_mobile_ml_model_${suffix}
AFTER ${event} ON ${TABLE}
WHEN COALESCE((SELECT enabled FROM sync_reference_capture_state WHERE singleton_id=1),1)=1
 AND NEW.uuid LIKE '${UUID_PREFIX}%'
BEGIN
  INSERT INTO sync_reference_outbox(
    record_type,record_id,store_name,player_id,workspace_id,payload_json,
    deleted,updated_at,status,attempt_count,last_error_code,last_error_message,created_at
  ) VALUES(
    '${RECORD_TYPE}',NEW.uuid,'${STORE}',
    json_extract(NEW.record_json,'$.parent'),NULL,NEW.record_json,0,
    COALESCE(
      json_extract(NEW.record_json,'$.syncUpdatedAt'),
      json_extract(NEW.record_json,'$.updatedAt'),
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

function deleteTrigger() {
  const deletedAt = `CASE
      WHEN COALESCE(json_extract(OLD.record_json,'$.syncUpdatedAt'),json_extract(OLD.record_json,'$.updatedAt'),'') >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
      THEN strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(json_extract(OLD.record_json,'$.syncUpdatedAt'),json_extract(OLD.record_json,'$.updatedAt')),'+0.001 seconds')
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now')
    END`;
  return `DROP TRIGGER IF EXISTS sync_reference_mobile_ml_model_delete;
CREATE TRIGGER sync_reference_mobile_ml_model_delete
AFTER DELETE ON ${TABLE}
WHEN COALESCE((SELECT enabled FROM sync_reference_capture_state WHERE singleton_id=1),1)=1
 AND OLD.uuid LIKE '${UUID_PREFIX}%'
BEGIN
  INSERT INTO sync_reference_outbox(
    record_type,record_id,store_name,player_id,workspace_id,payload_json,
    deleted,updated_at,status,attempt_count,last_error_code,last_error_message,created_at
  ) VALUES(
    '${RECORD_TYPE}',OLD.uuid,'${STORE}',
    json_extract(OLD.record_json,'$.parent'),NULL,
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

export const MOBILE_ML_MODEL_REFERENCE_CAPTURE_SQL = [
  putTrigger('INSERT'),
  putTrigger('UPDATE'),
  deleteTrigger(),
  'PRAGMA optimize;',
].join('\n\n').trim();

export const migration056 = Object.freeze({
  id: '056_mobile_ml_model_reference_capture',
  description: 'Synchronize only portable desktop-trained Task Recommender model artifacts to mobile.',
  sourceApplicationVersion: 'mobile-model-serving-v1',
  sql: MOBILE_ML_MODEL_REFERENCE_CAPTURE_SQL,
  checksum: 'b128b64d150f8cba16d6c6ca40f11c137901b59db6848cac84f6b8a81e1398b0',
});

export default migration056;
