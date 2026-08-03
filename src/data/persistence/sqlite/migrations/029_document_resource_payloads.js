export const COMPACT_RESOURCE_PAYLOADS_SQL = `
CREATE TABLE document_resource_payloads (
  content_hash TEXT PRIMARY KEY CHECK (
    length(content_hash) = 64
    AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 255),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  payload BLOB NOT NULL CHECK (length(payload) = byte_size),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE document_resource_payload_refs (
  resource_uuid TEXT PRIMARY KEY
    REFERENCES document_resources(uuid) ON DELETE CASCADE,
  content_hash TEXT NOT NULL
    REFERENCES document_resource_payloads(content_hash) ON DELETE RESTRICT
) STRICT;

CREATE INDEX document_resource_payload_refs_hash_idx
ON document_resource_payload_refs(content_hash, resource_uuid);

CREATE TRIGGER document_resource_payload_ref_cleanup_delete
AFTER DELETE ON document_resource_payload_refs
BEGIN
  DELETE FROM document_resource_payloads
  WHERE content_hash=OLD.content_hash
    AND NOT EXISTS (
      SELECT 1
      FROM document_resource_payload_refs
      WHERE content_hash=OLD.content_hash
    );
END;

CREATE TRIGGER document_resource_payload_ref_cleanup_update
AFTER UPDATE OF content_hash ON document_resource_payload_refs
WHEN OLD.content_hash IS NOT NEW.content_hash
BEGIN
  DELETE FROM document_resource_payloads
  WHERE content_hash=OLD.content_hash
    AND NOT EXISTS (
      SELECT 1
      FROM document_resource_payload_refs
      WHERE content_hash=OLD.content_hash
    );
END;
`.trim();

export const migration029 = Object.freeze({
  id: '029_document_resource_payloads',
  description: 'Persist compact managed-resource bytes outside JSON with content-addressed deduplication.',
  sourceApplicationVersion: 'compact-resource-payloads',
  sql: COMPACT_RESOURCE_PAYLOADS_SQL,
  checksum: '0fd3a0f735ce6c43b4c62d963c4969c8d70b9603b323674f1198df2514612aa5',
});

export default migration029;
