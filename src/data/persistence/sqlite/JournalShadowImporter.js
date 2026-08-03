import {
  compactJournalTargetPath,
  hashCompactJournal,
  JournalDocumentError,
  serializeCompactJournal,
  validateJournalPath,
} from '../journals/CompactJournalMarkdown.js';
import {
  createImportLedgerStatements,
  fingerprintShadowSource,
  stableJson,
  textOrNull,
} from './shadowDomainUtils.js';
import { sha256Text } from './migrationChecksum.js';

const IMPORTER_VERSION = 'batch14-compact-journals-v1';
const JOURNAL_META_KEYS = new Set(['uuid', 'player', 'createdAt', 'editedAt', 'inGameTimestamp']);

function normalizeLines(value) {
  return String(value ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').normalize('NFC');
}

function parseJournalDocument(markdown, { sourcePath = null, manifestId = null } = {}) {
  const normalized = normalizeLines(markdown);
  const lines = normalized.split('\n');
  const metadata = {};
  let cursor = 0;
  while (cursor < lines.length) {
    const match = lines[cursor].match(/^>\s*([A-Za-z][A-Za-z0-9]*):\s*(.*)$/u);
    if (!match) break;
    const [, key, value] = match;
    if (!JOURNAL_META_KEYS.has(key)) {
      throw new JournalDocumentError(`Journal contains unknown metadata key ${key}.`, {
        code: 'unknown-metadata', details: { key, sourcePath },
      });
    }
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      throw new JournalDocumentError(`Journal contains duplicate metadata key ${key}.`, {
        code: 'duplicate-metadata', details: { key, sourcePath },
      });
    }
    metadata[key] = value.trim();
    cursor += 1;
  }
  while (lines[cursor] === '') cursor += 1;
  if (!lines[cursor]?.startsWith('# ')) {
    throw new JournalDocumentError('Journal is missing its H1 title.', {
      code: 'missing-title', details: { sourcePath },
    });
  }
  const title = lines[cursor].slice(2);
  cursor += 1;
  if (lines[cursor] === '') cursor += 1;

  const attachments = [];
  while (cursor < lines.length) {
    const image = lines[cursor].match(/^\s*!\[\[([^\]]+)\]\]\s*$/u);
    if (!image) break;
    attachments.push(image[1]);
    cursor += 1;
  }
  if (attachments.length && lines[cursor] === '') cursor += 1;
  const body = [];
  for (; cursor < lines.length; cursor += 1) body.push(lines[cursor]);
  if (body.at(-1) === '') body.pop();

  const id = metadata.uuid || manifestId;
  if (!id) throw new JournalDocumentError('Journal is missing its UUID.', { code: 'missing-id', details: { sourcePath } });
  if (manifestId && metadata.uuid && String(manifestId) !== String(metadata.uuid)) {
    throw new JournalDocumentError('Journal UUID does not match its manifest entry.', {
      code: 'id-mismatch', details: { sourcePath, manifestId, documentId: metadata.uuid },
    });
  }
  if (!metadata.player) throw new JournalDocumentError('Journal is missing player metadata.', { code: 'missing-player', details: { sourcePath } });
  if (!metadata.createdAt || Number.isNaN(Date.parse(metadata.createdAt))) {
    throw new JournalDocumentError('Journal has an invalid createdAt value.', { code: 'invalid-created', details: { sourcePath } });
  }
  if (metadata.editedAt && Number.isNaN(Date.parse(metadata.editedAt))) {
    throw new JournalDocumentError('Journal has an invalid editedAt value.', { code: 'invalid-updated', details: { sourcePath } });
  }
  const inGameTimestamp = metadata.inGameTimestamp === '' || metadata.inGameTimestamp == null
    ? null
    : Number(metadata.inGameTimestamp);
  if (inGameTimestamp != null && !Number.isFinite(inGameTimestamp)) {
    throw new JournalDocumentError('Journal has an invalid inGameTimestamp.', {
      code: 'invalid-igt', details: { sourcePath },
    });
  }
  return {
    id: String(id),
    player: String(metadata.player),
    created: metadata.createdAt,
    updated: metadata.editedAt || null,
    title,
    body: body.join('\n'),
    attachments,
    inGameTimestamp,
  };
}

function metadataId(record) {
  return textOrNull(record?.UUID ?? record?.uuid ?? record?.journalUUID);
}

function metadataPath(record) {
  return textOrNull(record?.filePath ?? record?.path ?? record?.journalPath);
}

function quarantineId(sourceFingerprint, index, reason) {
  return `journal-quarantine:${sourceFingerprint.slice(0, 16)}:${String(index).padStart(6, '0')}:${reason}`;
}

function buildCompactBody(parsed) {
  if (!parsed.attachments.length) return parsed.body;
  const attachmentBlock = parsed.attachments.map((path) => `![[${path}]]`).join('\n');
  return parsed.body ? `${attachmentBlock}\n\n${parsed.body}` : attachmentBlock;
}

export class JournalShadowImporter {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('JournalShadowImporter requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async import({ journals = [], journalMetadata = [], runId = null } = {}) {
    const source = { journals, journalMetadata };
    const sourceFingerprint = await fingerprintShadowSource(source);
    const existing = await this.client.query({
      sql: `SELECT run_id AS runId,counts_json AS countsJson,diagnostics_json AS diagnosticsJson
            FROM shadow_import_runs
            WHERE domain='journals' AND source_fingerprint=? AND importer_version=?`,
      bind: [sourceFingerprint, IMPORTER_VERSION], result: 'one',
    });
    if (existing) {
      return {
        duplicate: true,
        runId: existing.runId,
        sourceFingerprint,
        counts: JSON.parse(existing.countsJson),
        diagnostics: JSON.parse(existing.diagnosticsJson),
        stagedDocuments: await this.listStagedDocuments(),
      };
    }

    const playerIds = new Set(await this.client.query({ sql: 'SELECT id FROM players', result: 'values' }));
    const metadataById = new Map();
    const metadataByPath = new Map();
    const diagnostics = [];
    for (const record of Array.isArray(journalMetadata) ? journalMetadata : []) {
      const id = metadataId(record);
      const path = metadataPath(record);
      if (id) {
        if (metadataById.has(id) && stableJson(metadataById.get(id)) !== stableJson(record)) {
          diagnostics.push({ kind: 'journal-metadata', recordId: id, reason: 'duplicate-id-different-record' });
        } else metadataById.set(id, record);
      }
      if (path) metadataByPath.set(path.replace(/^\/+/, ''), record);
      if (!id && !path) diagnostics.push({ kind: 'journal-metadata', reason: 'missing-id-and-path' });
    }

    const candidates = [];
    for (const [index, candidate] of (Array.isArray(journals) ? journals : []).entries()) {
      const manifest = candidate?.manifestEntry || candidate?.manifest || {};
      const sourcePathRaw = textOrNull(candidate?.path ?? manifest.path);
      const markdown = candidate?.markdown ?? candidate?.content ?? '';
      let sourcePath = sourcePathRaw;
      try {
        if (sourcePath) sourcePath = validateJournalPath(sourcePath, { allowStaging: true });
      } catch (error) {
        diagnostics.push({ kind: 'journal', index, reason: error.code || 'unsafe-source-path', sourcePath: sourcePathRaw });
        candidates.push({ index, sourcePath: sourcePathRaw, markdown, error });
        continue;
      }
      try {
        const parsed = parseJournalDocument(markdown, {
          sourcePath,
          manifestId: textOrNull(manifest.uuid ?? manifest.UUID),
        });
        const supplementalMetadata = metadataById.get(parsed.id) || metadataByPath.get(sourcePath) || {};
        candidates.push({ index, sourcePath, markdown, parsed, supplementalMetadata });
      } catch (error) {
        candidates.push({ index, sourcePath, markdown, error });
      }
    }

    candidates.sort((left, right) => {
      const leftKey = left.parsed ? `${left.parsed.id}\u0000${left.sourcePath || ''}\u0000${left.markdown}` : `~${String(left.index).padStart(8, '0')}`;
      const rightKey = right.parsed ? `${right.parsed.id}\u0000${right.sourcePath || ''}\u0000${right.markdown}` : `~${String(right.index).padStart(8, '0')}`;
      return leftKey.localeCompare(rightKey);
    });

    const selectedIds = new Set();
    const statements = [];
    const stagedDocuments = [];
    let quarantined = 0;
    let converted = 0;
    const timestamp = this.now().toISOString();
    for (const candidate of candidates) {
      if (candidate.error) {
        const reason = candidate.error?.code || 'invalid-journal-document';
        diagnostics.push({ kind: 'journal', index: candidate.index, sourcePath: candidate.sourcePath, reason });
        statements.push({
          sql: `INSERT INTO journal_import_quarantine(id,journal_id,source_path,reason,diagnostic_json,raw_markdown,quarantined_at)
                VALUES(?,?,?,?,?,?,?)`,
          bind: [quarantineId(sourceFingerprint, candidate.index, reason), null, candidate.sourcePath, reason,
            stableJson(candidate.error?.details || {}), String(candidate.markdown || ''), timestamp],
          result: 'changes',
        });
        quarantined += 1;
        continue;
      }
      const { parsed, supplementalMetadata } = candidate;
      if (selectedIds.has(parsed.id)) {
        const reason = 'duplicate-id-different-document';
        diagnostics.push({ kind: 'journal', recordId: parsed.id, sourcePath: candidate.sourcePath, reason });
        statements.push({
          sql: `INSERT INTO journal_import_quarantine(id,journal_id,source_path,reason,diagnostic_json,raw_markdown,quarantined_at)
                VALUES(?,?,?,?,?,?,?)`,
          bind: [quarantineId(sourceFingerprint, candidate.index, reason), parsed.id, candidate.sourcePath, reason,
            stableJson({ selectedId: parsed.id }), String(candidate.markdown || ''), timestamp],
          result: 'changes',
        });
        quarantined += 1;
        continue;
      }
      selectedIds.add(parsed.id);
      const compactMarkdown = serializeCompactJournal({
        id: parsed.id,
        player: parsed.player,
        created: parsed.created,
        updated: parsed.updated,
        title: parsed.title,
        body: buildCompactBody(parsed),
      });
      const compact = await hashCompactJournal(compactMarkdown, { expectedId: parsed.id });
      const sourceHash = await sha256Text(normalizeLines(candidate.markdown));
      const targetPath = compactJournalTargetPath({ id: parsed.id, created: parsed.created });
      const playerId = playerIds.has(parsed.player) ? parsed.player : null;
      if (!playerId) diagnostics.push({ kind: 'journal', recordId: parsed.id, reason: 'unknown-player', playerId: parsed.player });
      const extra = {
        sourcePlayerId: playerId ? undefined : parsed.player,
        sourceAttachments: parsed.attachments,
        supplementalMetadata,
        sourceHash,
      };
      statements.push({
        sql: `INSERT INTO journals(
                id,player_id,file_path,content_hash,title_projection,created_at,updated_at,
                in_game_timestamp,document_revision,document_state,source_path,imported_at,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,1,'staged',?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                player_id=excluded.player_id,file_path=excluded.file_path,content_hash=excluded.content_hash,
                title_projection=excluded.title_projection,created_at=excluded.created_at,
                updated_at=excluded.updated_at,in_game_timestamp=excluded.in_game_timestamp,
                document_state='staged',source_path=excluded.source_path,imported_at=excluded.imported_at,
                extra_json=excluded.extra_json`,
        bind: [parsed.id, playerId, targetPath, compact.contentHash, parsed.title, parsed.created, parsed.updated,
          parsed.inGameTimestamp, candidate.sourcePath, timestamp, stableJson(extra)],
        result: 'changes',
      }, {
        sql: `INSERT INTO journal_import_staging(
                journal_id,source_path,target_path,compact_markdown,content_hash,byte_length,status,staged_at,updated_at
              ) VALUES(?,?,?,?,?,?,'staged',?,?)
              ON CONFLICT(journal_id) DO UPDATE SET
                source_path=excluded.source_path,target_path=excluded.target_path,
                compact_markdown=excluded.compact_markdown,content_hash=excluded.content_hash,
                byte_length=excluded.byte_length,status='staged',updated_at=excluded.updated_at`,
        bind: [parsed.id, candidate.sourcePath, targetPath, compact.markdown, compact.contentHash,
          compact.byteLength, timestamp, timestamp],
        result: 'changes',
      });
      stagedDocuments.push({
        id: parsed.id,
        sourcePath: candidate.sourcePath,
        targetPath,
        markdown: compact.markdown,
        contentHash: compact.contentHash,
        byteLength: compact.byteLength,
        sourceHash,
      });
      converted += 1;
    }

    for (const [id, metadata] of metadataById) {
      if (!selectedIds.has(id)) diagnostics.push({ kind: 'journal-metadata', recordId: id, reason: 'orphan-metadata' });
      void metadata;
    }

    const counts = {
      inputDocuments: Array.isArray(journals) ? journals.length : 0,
      converted,
      quarantined,
      metadataRecords: Array.isArray(journalMetadata) ? journalMetadata.length : 0,
      diagnostics: diagnostics.length,
    };
    const effectiveRunId = runId || `journals:${sourceFingerprint.slice(0, 24)}`;
    statements.push(...createImportLedgerStatements({
      runId: effectiveRunId,
      domain: 'journals',
      sourceFingerprint,
      importerVersion: IMPORTER_VERSION,
      startedAt: timestamp,
      finishedAt: timestamp,
      counts,
      diagnostics,
    }));
    await this.client.executeAtomic({
      commandId: `shadow-import:${effectiveRunId}`,
      label: 'compact-journal-shadow-import',
      statements,
    });
    return { duplicate: false, runId: effectiveRunId, sourceFingerprint, counts, diagnostics, stagedDocuments };
  }

  async listStagedDocuments() {
    return this.client.query({
      sql: `SELECT journal_id AS id,source_path AS sourcePath,target_path AS targetPath,
                   compact_markdown AS markdown,content_hash AS contentHash,byte_length AS byteLength,status
            FROM journal_import_staging ORDER BY journal_id`,
      result: 'all',
    });
  }
}

export default JournalShadowImporter;
