const contextTables = [
  'document_profile_context_recipients', 'document_profile_context_suggestions',
  'document_profile_context_audit', 'document_profile_context_preferences', 'document_profile_context_items',
  'profile_context_recipients', 'profile_context_suggestions', 'profile_context_audit',
  'profile_context_preferences', 'profile_context_items',
];

export const REMOVE_PROFILE_CONTEXT_SQL = `
${contextTables.map((table) => `DELETE FROM ${table};`).join('\n')}
UPDATE document_players AS p SET record_json=json_set(record_json,'$.profilePersonalization.blocks',json((
  SELECT COALESCE(json_group_array(json(value)),'[]') FROM json_each(p.record_json,'$.profilePersonalization.blocks')
  WHERE json_extract(value,'$.type')!='lifeContext'
))) WHERE json_type(record_json,'$.profilePersonalization.blocks')='array';
UPDATE players AS p SET extra_json=json_set(extra_json,'$.profilePersonalization.blocks',json((
  SELECT COALESCE(json_group_array(json(value)),'[]') FROM json_each(p.extra_json,'$.profilePersonalization.blocks')
  WHERE json_extract(value,'$.type')!='lifeContext'
))) WHERE json_type(extra_json,'$.profilePersonalization.blocks')='array';
DELETE FROM source_versions WHERE source_key='profileContext';
PRAGMA optimize;
`.trim();

export default Object.freeze({
  id: '063_remove_profile_context',
  description: 'Delete Context records and Life Context profile blocks, preserving friends and immutable Matches.',
  sourceApplicationVersion: 'v2-pruning',
  sql: REMOVE_PROFILE_CONTEXT_SQL,
  checksum: '11dbe1a0942b24035665619f8adf1d0a10db64501bfe3b97d7f86ee73203da37',
});
