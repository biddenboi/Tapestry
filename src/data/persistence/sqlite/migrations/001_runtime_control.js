export const migration001 = Object.freeze({
  id: '001_runtime_control',
  description: 'Create idempotent runtime command receipts.',
  sourceApplicationVersion: 'batch9',
  sql: `
CREATE TABLE runtime_command_receipts (
  command_id TEXT PRIMARY KEY,
  command_label TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  committed_at TEXT NOT NULL
) STRICT;

CREATE INDEX runtime_command_receipts_committed_idx
ON runtime_command_receipts(committed_at DESC);
`.trim(),
  checksum: '4549863c26085e25e04fa7810787251ec3f23d54fa747a4733e052b4c16ee7d4',
});

export default migration001;
