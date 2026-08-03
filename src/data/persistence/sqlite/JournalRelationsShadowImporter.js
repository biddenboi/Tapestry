import {
  createImportLedgerStatements,
  deterministicRows,
  fingerprintShadowSource,
  omitKeys,
  stableJson,
  textOrNull,
} from './shadowDomainUtils.js';

const IMPORTER_VERSION = 'batch16-journal-relations-v1';
const META_COLUMNS = Object.freeze([
  'UUID','uuid','journalUUID','tags','votes','pinned','isPinned','sortAt','feedState','visibility','updatedAt',
]);
const COMMENT_COLUMNS = Object.freeze([
  'UUID','journalUUID','authorUUID','parent','text','createdAt','updatedAt','inGameTimestamp','deletedAt','votes',
]);

function normalizeTag(value) {
  const tag = String(value ?? '').trim().replace(/^#+/, '').normalize('NFC');
  if (!tag || new TextEncoder().encode(tag).byteLength > 128) return null;
  return { tag, normalized: tag.toLocaleLowerCase('en-US') };
}

function boundedJson(value, fallback = { version: 1 }) {
  const normalized = value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  const text = stableJson({ version: Number(normalized.version) || 1, ...normalized });
  if (new TextEncoder().encode(text).byteLength > 65536) return null;
  return text;
}

function journalId(record) {
  return textOrNull(record?.UUID ?? record?.uuid ?? record?.journalUUID);
}

export class JournalRelationsShadowImporter {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('JournalRelationsShadowImporter requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async import({ journalMetadata = [], journalComments = [], runId = null } = {}) {
    const source = { journalMetadata, journalComments };
    const sourceFingerprint = await fingerprintShadowSource(source);
    const existing = await this.client.query({
      sql: `SELECT run_id AS runId,counts_json AS countsJson,diagnostics_json AS diagnosticsJson
            FROM shadow_import_runs
            WHERE domain='journal-relations' AND source_fingerprint=? AND importer_version=?`,
      bind: [sourceFingerprint, IMPORTER_VERSION], result: 'one',
    });
    if (existing) return {
      duplicate: true,
      runId: existing.runId,
      sourceFingerprint,
      counts: JSON.parse(existing.countsJson),
      diagnostics: JSON.parse(existing.diagnosticsJson),
    };

    const journalIds = new Set(await this.client.query({ sql: 'SELECT id FROM journals', result: 'values' }));
    const playerIds = new Set(await this.client.query({ sql: 'SELECT id FROM players', result: 'values' }));
    const metadataInput = deterministicRows(journalMetadata, { id: journalId, kind: 'journal-metadata' });
    const commentInput = deterministicRows(journalComments, { kind: 'journal-comment' });
    const diagnostics = [
      ...metadataInput.rejected,
      ...metadataInput.conflicts,
      ...commentInput.rejected,
      ...commentInput.conflicts,
    ];
    const statements = [];
    const timestamp = this.now().toISOString();
    let metadataCount = 0;
    let tagCount = 0;
    let voteCount = 0;
    let commentCount = 0;
    let commentVoteCount = 0;

    for (const metadata of metadataInput.selected) {
      const id = journalId(metadata);
      if (!journalIds.has(id)) {
        diagnostics.push({ kind: 'journal-metadata', recordId: id, reason: 'unknown-journal' });
        continue;
      }
      const feedState = boundedJson(metadata.feedState);
      if (!feedState) {
        diagnostics.push({ kind: 'journal-metadata', recordId: id, reason: 'feed-state-too-large' });
      }
      const visibility = ['visible','hidden','draft'].includes(metadata.visibility) ? metadata.visibility : 'visible';
      statements.push({
        sql: `INSERT INTO journal_feed_metadata(journal_id,pinned,sort_at,visibility,feed_state_json,updated_at)
              VALUES(?,?,?,?,?,?)
              ON CONFLICT(journal_id) DO UPDATE SET
                pinned=excluded.pinned,sort_at=excluded.sort_at,visibility=excluded.visibility,
                feed_state_json=excluded.feed_state_json,updated_at=excluded.updated_at`,
        bind: [id, metadata.pinned === true || metadata.isPinned === true ? 1 : 0,
          textOrNull(metadata.sortAt), visibility, feedState || '{"version":1}',
          textOrNull(metadata.updatedAt) || timestamp],
        result: 'changes',
      }, {
        sql: 'DELETE FROM journal_tags WHERE journal_id=?', bind: [id], result: 'changes',
      }, {
        sql: 'DELETE FROM journal_votes WHERE journal_id=?', bind: [id], result: 'changes',
      });
      const tags = new Map();
      for (const raw of Array.isArray(metadata.tags) ? metadata.tags : []) {
        const tag = normalizeTag(raw);
        if (!tag) {
          diagnostics.push({ kind: 'journal-tag', recordId: id, reason: 'invalid-tag', value: String(raw ?? '') });
          continue;
        }
        if (!tags.has(tag.normalized)) tags.set(tag.normalized, tag.tag);
      }
      for (const [normalized, tag] of [...tags.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        statements.push({
          sql: 'INSERT INTO journal_tags(journal_id,tag,normalized_tag) VALUES(?,?,?)',
          bind: [id, tag, normalized], result: 'changes',
        });
        tagCount += 1;
      }
      for (const [voterId, rawValue] of Object.entries(metadata.votes || {}).sort(([a], [b]) => a.localeCompare(b))) {
        const value = Number(rawValue);
        if (!playerIds.has(voterId) || ![-1, 1].includes(value)) {
          diagnostics.push({ kind: 'journal-vote', recordId: id, voterId, reason: !playerIds.has(voterId) ? 'unknown-player' : 'invalid-vote' });
          continue;
        }
        statements.push({
          sql: 'INSERT INTO journal_votes(journal_id,voter_id,value,updated_at) VALUES(?,?,?,?)',
          bind: [id, voterId, value, timestamp], result: 'changes',
        });
        voteCount += 1;
      }
      metadataCount += 1;
    }

    for (const comment of commentInput.selected) {
      const id = String(comment.UUID);
      const targetJournal = textOrNull(comment.journalUUID);
      if (!journalIds.has(targetJournal)) {
        diagnostics.push({ kind: 'journal-comment', recordId: id, reason: 'unknown-journal', journalId: targetJournal });
        continue;
      }
      const text = String(comment.text ?? '').normalize('NFC');
      if (new TextEncoder().encode(text).byteLength > 65536) {
        diagnostics.push({ kind: 'journal-comment', recordId: id, reason: 'text-too-large' });
        continue;
      }
      const requestedAuthor = textOrNull(comment.authorUUID ?? comment.parent);
      const authorId = requestedAuthor && playerIds.has(requestedAuthor) ? requestedAuthor : null;
      if (requestedAuthor && !authorId) diagnostics.push({ kind: 'journal-comment', recordId: id, reason: 'unknown-author', authorId: requestedAuthor });
      statements.push({
        sql: `INSERT INTO journal_comments(
                id,journal_id,author_id,text,created_at,updated_at,in_game_timestamp,deleted_at,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                journal_id=excluded.journal_id,author_id=excluded.author_id,text=excluded.text,
                created_at=excluded.created_at,updated_at=excluded.updated_at,
                in_game_timestamp=excluded.in_game_timestamp,deleted_at=excluded.deleted_at,extra_json=excluded.extra_json`,
        bind: [id, targetJournal, authorId, text, textOrNull(comment.createdAt) || timestamp,
          textOrNull(comment.updatedAt), Number.isFinite(Number(comment.inGameTimestamp)) ? Math.trunc(Number(comment.inGameTimestamp)) : null,
          textOrNull(comment.deletedAt), stableJson(omitKeys(comment, COMMENT_COLUMNS))],
        result: 'changes',
      }, {
        sql: 'DELETE FROM journal_comment_votes WHERE comment_id=?', bind: [id], result: 'changes',
      });
      for (const [voterId, rawValue] of Object.entries(comment.votes || {}).sort(([a], [b]) => a.localeCompare(b))) {
        const value = Number(rawValue);
        if (!playerIds.has(voterId) || ![-1, 1].includes(value)) {
          diagnostics.push({ kind: 'journal-comment-vote', recordId: id, voterId, reason: !playerIds.has(voterId) ? 'unknown-player' : 'invalid-vote' });
          continue;
        }
        statements.push({
          sql: 'INSERT INTO journal_comment_votes(comment_id,voter_id,value,updated_at) VALUES(?,?,?,?)',
          bind: [id, voterId, value, timestamp], result: 'changes',
        });
        commentVoteCount += 1;
      }
      commentCount += 1;
    }

    const counts = {
      metadata: metadataCount,
      tags: tagCount,
      votes: voteCount,
      comments: commentCount,
      commentVotes: commentVoteCount,
      diagnostics: diagnostics.length,
    };
    const effectiveRunId = runId || `journal-relations:${sourceFingerprint.slice(0, 24)}`;
    statements.push(...createImportLedgerStatements({
      runId: effectiveRunId,
      domain: 'journal-relations',
      sourceFingerprint,
      importerVersion: IMPORTER_VERSION,
      startedAt: timestamp,
      finishedAt: timestamp,
      counts,
      diagnostics,
    }));
    await this.client.executeAtomic({
      commandId: `shadow-import:${effectiveRunId}`,
      label: 'journal-relations-shadow-import',
      statements,
    });
    return { duplicate: false, runId: effectiveRunId, sourceFingerprint, counts, diagnostics };
  }
}

export default JournalRelationsShadowImporter;
