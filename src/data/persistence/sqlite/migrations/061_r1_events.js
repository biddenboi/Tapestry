export const R1_EVENTS_SQL = `CREATE TABLE document_r1_events (
  uuid TEXT PRIMARY KEY,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  parent_uuid TEXT,
  created_at TEXT,
  updated_at TEXT,
  in_game_timestamp INTEGER,
  sort_key TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence >= 1)
) STRICT;
CREATE UNIQUE INDEX document_r1_events_sequence_idx ON document_r1_events(sequence);
CREATE INDEX document_r1_events_parent_timeline_idx ON document_r1_events(parent_uuid,in_game_timestamp,sort_key,uuid);
CREATE INDEX document_r1_events_sort_idx ON document_r1_events(sort_key,uuid);
CREATE TRIGGER r1_events_immutable BEFORE UPDATE ON document_r1_events BEGIN SELECT RAISE(ABORT,'R1 events are append-only'); END;`;
export default Object.freeze({ id: "061_r1_events", description: "Append-only R1 scheduling events.", sourceApplicationVersion: "r1", sql: R1_EVENTS_SQL, checksum: "30edf91c133a0edccd183606ad8c4ad0f82950b1bb4a976565c3df17f385dbd5" });
