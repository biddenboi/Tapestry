const retiredTables = [
  'document_next_move_feedback', 'document_next_move_surface_preferences', 'document_next_move_decisions',
  'next_move_feedback', 'next_move_surface_preferences', 'next_move_decisions',
];

export const REMOVE_NEXT_MOVE_SQL = `
${retiredTables.map((table) => `DELETE FROM ${table};`).join('\n')}
DELETE FROM source_versions WHERE source_key='nextMove';
PRAGMA optimize;
`.trim();

export default Object.freeze({
  id: '064_remove_next_move',
  description: 'Delete Next Move decisions, feedback and placement; preserve task plans, active sessions and R1 history.',
  sourceApplicationVersion: 'v2-pruning',
  sql: REMOVE_NEXT_MOVE_SQL,
  checksum: 'c2569977a4774b9b0d3cf8c4c69cdbd39947d14962ee11f48d2d22a0c2bee342',
});
