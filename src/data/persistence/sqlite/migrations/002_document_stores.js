import { buildDocumentSchemaSql } from '../documentStores.js';

export const migration002 = Object.freeze({
  id: '002_document_stores',
  description: 'Create explicit canonical JSON document tables for complete current records.',
  sourceApplicationVersion: 'batch10',
  sql: buildDocumentSchemaSql({ includeGoalStores: false }),
  checksum: 'f17ce5a2916a53f1b5fd4d113b0e73c866a7e40e75f298be13f3b9e15b05cc05',
});

export default migration002;
