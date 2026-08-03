import {
  compactJournalVersionPath,
  hashCompactJournal,
  parseCompactJournal,
  serializeCompactJournal,
  validateJournalPath,
} from './CompactJournalMarkdown.js';
import { sha256Text } from '../sqlite/migrationChecksum.js';
import { stableJson } from '../sqlite/shadowDomainUtils.js';

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function rowToJournal(row) {
  if (!row) return null;
  return {
    id: row.id,
    player: row.playerId,
    filePath: row.filePath,
    contentHash: row.contentHash,
    title: row.title,
    created: row.created,
    updated: row.updated,
    inGameTimestamp: row.inGameTimestamp,
    revision: Number(row.revision),
    state: row.state,
    deletedAt: row.deletedAt,
  };
}

function rowToOperation(row) {
  if (!row) return null;
  return {
    operationId: row.operationId,
    journalId: row.journalId,
    type: row.type,
    state: row.state,
    expectedPath: row.expectedPath,
    expectedHash: row.expectedHash,
    expectedRevision: row.expectedRevision == null ? null : Number(row.expectedRevision),
    targetPath: row.targetPath,
    targetHash: row.targetHash,
    targetRevision: row.targetRevision == null ? null : Number(row.targetRevision),
    targetMarkdown: row.targetMarkdown,
    errorCode: row.errorCode,
  };
}

const JOURNAL_SELECT = `
SELECT id,player_id AS playerId,file_path AS filePath,content_hash AS contentHash,
       title_projection AS title,created_at AS created,updated_at AS updated,
       in_game_timestamp AS inGameTimestamp,document_revision AS revision,
       document_state AS state,deleted_at AS deletedAt
FROM journals`;

const OP_SELECT = `
SELECT operation_id AS operationId,journal_id AS journalId,operation_type AS type,state,
       expected_path AS expectedPath,expected_hash AS expectedHash,expected_revision AS expectedRevision,
       target_path AS targetPath,target_hash AS targetHash,target_revision AS targetRevision,
       target_markdown AS targetMarkdown,error_code AS errorCode
FROM journal_file_ops`;

export class JournalFileOperationService {
  constructor({ client, fileAdapter, now = () => new Date(), retentionMs = DEFAULT_RETENTION_MS, phaseHook = null } = {}) {
    if (!client) throw new Error('JournalFileOperationService requires a SQLite client.');
    if (!fileAdapter) throw new Error('JournalFileOperationService requires a journal file adapter.');
    this.client = client;
    this.fileAdapter = fileAdapter;
    this.now = now;
    this.retentionMs = retentionMs;
    this.phaseHook = phaseHook;
  }

  async _phase(name, context) {
    if (this.phaseHook) await this.phaseHook(name, context);
  }

  async getJournal(id) {
    return rowToJournal(await this.client.query({ sql: `${JOURNAL_SELECT} WHERE id=?`, bind: [id], result: 'one' }));
  }

  async getOperation(operationId) {
    return rowToOperation(await this.client.query({ sql: `${OP_SELECT} WHERE operation_id=?`, bind: [operationId], result: 'one' }));
  }

  async publishStagedImport(journalId, { operationId = `journal-import:${journalId}` } = {}) {
    const staging = await this.client.query({
      sql: `SELECT s.compact_markdown AS markdown,s.content_hash AS contentHash,
                   j.document_revision AS revision,j.file_path AS logicalPath
            FROM journal_import_staging s JOIN journals j ON j.id=s.journal_id
            WHERE s.journal_id=?`,
      bind: [journalId], result: 'one',
    });
    if (!staging) return { status: 'missing-staging', journalId };
    return this._prepareAndRun({
      operationId,
      journalId,
      type: 'create',
      expectedPath: null,
      expectedHash: staging.contentHash,
      expectedRevision: Number(staging.revision),
      markdown: staging.markdown,
    });
  }

  async updateJournal(journalId, document, {
    operationId,
    expectedRevision,
    expectedHash,
  } = {}) {
    if (!operationId) throw new Error('Journal updates require an operation ID.');
    const markdown = typeof document === 'string' ? document : serializeCompactJournal({ ...document, id: journalId });
    return this._prepareAndRun({
      operationId,
      journalId,
      type: 'update',
      expectedRevision,
      expectedHash,
      markdown,
    });
  }

  async moveJournal(journalId, targetPath, { operationId, expectedRevision, expectedHash } = {}) {
    if (!operationId) throw new Error('Journal moves require an operation ID.');
    const journal = await this.getJournal(journalId);
    if (!journal) return { status: 'missing', journalId };
    const markdown = await this.fileAdapter.readText(journal.filePath);
    if (markdown == null) return { status: 'missing-file', journal };
    return this._prepareAndRun({
      operationId,
      journalId,
      type: 'move',
      expectedRevision,
      expectedHash,
      markdown,
      targetPathOverride: validateJournalPath(targetPath, { allowStaging: true }),
    });
  }

  async deleteJournal(journalId, { operationId, expectedRevision, expectedHash } = {}) {
    if (!operationId) throw new Error('Journal deletes require an operation ID.');
    return this._prepareAndRun({
      operationId,
      journalId,
      type: 'delete',
      expectedRevision,
      expectedHash,
      markdown: null,
    });
  }

  async _prepareAndRun({ operationId, journalId, type, expectedRevision, expectedHash, expectedPath = undefined, markdown, targetPathOverride = null }) {
    const existing = await this.getOperation(operationId);
    if (existing) return this._resume(existing);
    const journal = await this.getJournal(journalId);
    if (!journal) return { status: 'missing', journalId };
    const effectiveExpectedRevision = Number(expectedRevision ?? journal.revision);
    const effectiveExpectedHash = expectedHash ?? journal.contentHash;
    const effectiveExpectedPath = expectedPath === undefined ? journal.filePath : expectedPath;
    if (effectiveExpectedRevision !== journal.revision
      || (effectiveExpectedHash != null && effectiveExpectedHash !== journal.contentHash)) {
      return { status: 'stale', journal };
    }

    let compact = null;
    let targetPath = null;
    let targetRevision = journal.revision + (type === 'create' && journal.state === 'staged' ? 0 : 1);
    if (type !== 'delete') {
      compact = await hashCompactJournal(markdown, { expectedId: journalId });
      targetPath = targetPathOverride || compactJournalVersionPath(journalId, compact.contentHash);
    }
    const timestamp = this.now().toISOString();
    const result = await this.client.executeAtomic({
      commandId: `journal-op-prepare:${operationId}`,
      label: 'journal-file-op-prepare',
      statements: [{
        sql: `INSERT INTO journal_file_ops(
                operation_id,journal_id,operation_type,state,expected_path,expected_hash,expected_revision,
                target_path,target_hash,target_revision,target_markdown,prepared_at,error_detail_json
              )
              SELECT ?,?,?, 'prepared',?,?,?,?,?,?,?,?, '{}'
              FROM journals
              WHERE id=? AND document_revision=? AND content_hash=? AND deleted_at IS NULL
              ON CONFLICT(operation_id) DO NOTHING`,
        bind: [operationId, journalId, type, effectiveExpectedPath, effectiveExpectedHash, effectiveExpectedRevision,
          targetPath, compact?.contentHash ?? null, targetRevision, compact?.markdown ?? null, timestamp,
          journalId, journal.revision, journal.contentHash],
        result: 'changes',
      }],
    });
    const operation = await this.getOperation(operationId);
    if (!operation) return { status: 'stale', journal: await this.getJournal(journalId), duplicate: result.duplicate };
    await this._phase('after-prepare', { operation });
    return this._resume(operation);
  }

  async _resume(operation) {
    if (operation.state === 'indexed') {
      return { status: 'indexed', operation, journal: await this.getJournal(operation.journalId), idempotent: true };
    }
    if (operation.state === 'quarantined' || operation.state === 'cancelled') {
      return { status: operation.state, operation, journal: await this.getJournal(operation.journalId) };
    }
    if (operation.type === 'delete') return this._resumeDelete(operation);
    return this._resumePublication(operation);
  }

  async _verifyExpectedFile(operation) {
    if (!operation.expectedPath || !operation.expectedHash) return { status: 'ok' };
    const prior = await this.fileAdapter.readText(operation.expectedPath);
    if (prior == null) return this._quarantine(operation, 'expected-file-missing', { path: operation.expectedPath });
    let actual;
    try { actual = await hashCompactJournal(prior, { expectedId: operation.journalId, path: operation.expectedPath }); }
    catch (error) {
      return this._quarantine(operation, 'expected-file-invalid', { path: operation.expectedPath, error: error.code || error.message });
    }
    if (actual.contentHash === operation.expectedHash) return { status: 'ok', actual };
    await this._importExternal(operation.journalId, operation.expectedPath, actual, {
      operationId: `external-before:${operation.operationId}`,
      issueOperationId: operation.operationId,
    });
    return this._quarantine(operation, 'external-edit', {
      path: operation.expectedPath,
      expectedHash: operation.expectedHash,
      actualHash: actual.contentHash,
    });
  }

  async _resumePublication(operation) {
    const expected = await this._verifyExpectedFile(operation);
    if (expected.status !== 'ok') return expected;
    if (operation.state === 'prepared') {
      const currentTarget = await this.fileAdapter.readText(operation.targetPath);
      if (currentTarget == null) await this.fileAdapter.writeText(operation.targetPath, operation.targetMarkdown);
      const verifiedText = await this.fileAdapter.readText(operation.targetPath);
      const verified = await hashCompactJournal(verifiedText, {
        expectedId: operation.journalId,
        path: operation.targetPath,
      });
      if (verified.contentHash !== operation.targetHash) {
        return this._quarantine(operation, 'target-hash-mismatch', {
          path: operation.targetPath,
          expectedHash: operation.targetHash,
          actualHash: verified.contentHash,
        });
      }
      await this._phase('after-file-publish', { operation, verified });
      const publishedAt = this.now().toISOString();
      await this.client.executeAtomic({
        commandId: `journal-op-published:${operation.operationId}`,
        label: 'journal-file-op-published',
        statements: [{
          sql: `UPDATE journal_file_ops SET state='published',published_at=?
                WHERE operation_id=? AND state='prepared'`,
          bind: [publishedAt, operation.operationId], result: 'changes',
        }],
      });
      operation = await this.getOperation(operation.operationId);
      await this._phase('after-published-state', { operation });
    }
    if (operation.state === 'published') {
      const verifiedText = await this.fileAdapter.readText(operation.targetPath);
      if (verifiedText == null) return this._quarantine(operation, 'published-file-missing', { path: operation.targetPath });
      const verified = await hashCompactJournal(verifiedText, { expectedId: operation.journalId, path: operation.targetPath });
      if (verified.contentHash !== operation.targetHash) {
        return this._quarantine(operation, 'published-file-changed', {
          path: operation.targetPath, expectedHash: operation.targetHash, actualHash: verified.contentHash,
        });
      }
      const indexedAt = this.now().toISOString();
      const oldPath = operation.expectedPath && operation.expectedPath !== operation.targetPath ? operation.expectedPath : null;
      const statements = [{
        sql: `UPDATE journals SET
                player_id=COALESCE((SELECT id FROM players WHERE id=?),player_id),
                file_path=?,content_hash=?,title_projection=?,created_at=?,updated_at=?,
                document_revision=?,document_state='indexed',deleted_at=NULL
              WHERE id=? AND document_revision=? AND content_hash=?`,
        bind: [verified.player, operation.targetPath, verified.contentHash, verified.title,
          verified.created, verified.updated, operation.targetRevision, operation.journalId,
          operation.expectedRevision, operation.expectedHash],
        result: 'changes',
      }, {
        sql: `UPDATE journal_file_ops SET state='indexed',indexed_at=?
              WHERE operation_id=? AND state='published'`,
        bind: [indexedAt, operation.operationId], result: 'changes',
      }, {
        sql: `UPDATE journal_import_staging SET status='indexed',updated_at=? WHERE journal_id=?`,
        bind: [indexedAt, operation.journalId], result: 'changes',
      }];
      if (oldPath) statements.push({
        sql: `INSERT INTO journal_file_garbage_candidates(path,journal_id,content_hash,reason,eligible_after,created_at)
              VALUES(?,?,?,'superseded-version',?,?) ON CONFLICT(path) DO NOTHING`,
        bind: [oldPath, operation.journalId, operation.expectedHash,
          new Date(this.now().getTime() + this.retentionMs).toISOString(), indexedAt], result: 'changes',
      });
      await this.client.executeAtomic({
        commandId: `journal-op-index:${operation.operationId}`,
        label: 'journal-file-op-index',
        statements,
      });
      operation = await this.getOperation(operation.operationId);
      await this._phase('after-index', { operation });
    }
    return { status: operation.state, operation, journal: await this.getJournal(operation.journalId) };
  }

  async _resumeDelete(operation) {
    const expected = await this._verifyExpectedFile(operation);
    if (expected.status !== 'ok') return expected;
    if (operation.state === 'prepared') {
      const timestamp = this.now().toISOString();
      const purgeAfter = new Date(this.now().getTime() + this.retentionMs).toISOString();
      await this.client.executeAtomic({
        commandId: `journal-op-delete-index:${operation.operationId}`,
        label: 'journal-file-op-delete-index',
        statements: [{
          sql: `UPDATE journals SET document_revision=?,document_state='deleted',deleted_at=?
                WHERE id=? AND document_revision=? AND content_hash=? AND deleted_at IS NULL`,
          bind: [operation.targetRevision, timestamp, operation.journalId, operation.expectedRevision, operation.expectedHash],
          result: 'changes',
        }, {
          sql: `INSERT INTO journal_file_tombstones(journal_id,last_path,last_hash,revision,tombstoned_at,purge_after,operation_id)
                VALUES(?,?,?,?,?,?,?)
                ON CONFLICT(journal_id) DO UPDATE SET
                  last_path=excluded.last_path,last_hash=excluded.last_hash,revision=excluded.revision,
                  tombstoned_at=excluded.tombstoned_at,purge_after=excluded.purge_after,operation_id=excluded.operation_id`,
          bind: [operation.journalId, operation.expectedPath, operation.expectedHash, operation.targetRevision,
            timestamp, purgeAfter, operation.operationId], result: 'changes',
        }, {
          sql: `INSERT INTO journal_file_garbage_candidates(path,journal_id,content_hash,reason,eligible_after,created_at)
                VALUES(?,?,?,'deleted-journal',?,?) ON CONFLICT(path) DO NOTHING`,
          bind: [operation.expectedPath, operation.journalId, operation.expectedHash, purgeAfter, timestamp], result: 'changes',
        }, {
          sql: `UPDATE journal_file_ops SET state='indexed',indexed_at=?
                WHERE operation_id=? AND state='prepared'`,
          bind: [timestamp, operation.operationId], result: 'changes',
        }],
      });
      operation = await this.getOperation(operation.operationId);
      await this._phase('after-index', { operation });
    }
    return { status: operation.state, operation, journal: await this.getJournal(operation.journalId) };
  }

  async _quarantine(operation, code, details = {}) {
    const timestamp = this.now().toISOString();
    const issueId = await sha256Text(`journal-issue:${code}:${operation.operationId}:${stableJson(details)}`);
    await this.client.executeAtomic({
      commandId: `journal-op-quarantine:${operation.operationId}:${code}`,
      label: 'journal-file-op-quarantine',
      statements: [{
        sql: `UPDATE journal_file_ops SET state='quarantined',error_code=?,error_detail_json=?
              WHERE operation_id=? AND state NOT IN ('indexed','cancelled')`,
        bind: [code, stableJson(details), operation.operationId], result: 'changes',
      }, {
        sql: `INSERT INTO journal_reconciliation_issues(
                id,issue_type,journal_id,operation_id,path,expected_hash,actual_hash,detail_json,detected_at
              ) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
        bind: [issueId, code, operation.journalId, operation.operationId, details.path || null,
          details.expectedHash || operation.expectedHash, details.actualHash || null, stableJson(details), timestamp],
        result: 'changes',
      }],
    });
    const current = await this.getOperation(operation.operationId);
    return { status: 'quarantined', operation: current, journal: await this.getJournal(operation.journalId), issueId };
  }

  async _importExternal(journalId, path, compact, { operationId, issueOperationId = null } = {}) {
    const current = await this.getJournal(journalId);
    if (!current) return { status: 'missing' };
    const timestamp = this.now().toISOString();
    const externalOperationId = operationId || `external:${journalId}:${compact.contentHash.slice(0, 20)}`;
    await this.client.executeAtomic({
      commandId: `journal-external-import:${externalOperationId}`,
      label: 'journal-external-import',
      statements: [{
        sql: `INSERT INTO journal_file_ops(
                operation_id,journal_id,operation_type,state,expected_path,expected_hash,expected_revision,
                target_path,target_hash,target_revision,target_markdown,prepared_at,published_at,indexed_at,error_detail_json
              ) VALUES(?,?,'external-import','indexed',?,?,?,?,?,?,?,?,?,?, '{}')
              ON CONFLICT(operation_id) DO NOTHING`,
        bind: [externalOperationId, journalId, current.filePath, current.contentHash, current.revision,
          path, compact.contentHash, current.revision + 1, compact.markdown, timestamp, timestamp, timestamp],
        result: 'changes',
      }, {
        sql: `UPDATE journals SET file_path=?,content_hash=?,title_projection=?,created_at=?,updated_at=?,
                     document_revision=document_revision+1,document_state='indexed'
              WHERE id=? AND document_revision=? AND content_hash=?`,
        bind: [path, compact.contentHash, compact.title, compact.created, compact.updated,
          journalId, current.revision, current.contentHash], result: 'changes',
      }],
    });
    if (issueOperationId) {
      const issueId = await sha256Text(`journal-issue:external-edit:${issueOperationId}:${compact.contentHash}`);
      await this.client.executeAtomic({
        commandId: `journal-external-issue:${issueId}`,
        label: 'journal-external-issue',
        statements: [{
          sql: `INSERT INTO journal_reconciliation_issues(
                  id,issue_type,journal_id,operation_id,path,expected_hash,actual_hash,detail_json,detected_at,resolved_at,resolution
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
          bind: [issueId, 'external-edit-imported', journalId, issueOperationId, path,
            current.contentHash, compact.contentHash, '{}', timestamp, timestamp, 'imported-external-document'],
          result: 'changes',
        }],
      });
    }
    return { status: 'imported', journal: await this.getJournal(journalId) };
  }

  async _recordIssue(type, { journalId = null, operationId = null, path = null, expectedHash = null, actualHash = null, details = {} } = {}) {
    const timestamp = this.now().toISOString();
    const id = await sha256Text(`journal-issue:${type}:${journalId || ''}:${operationId || ''}:${path || ''}:${expectedHash || ''}:${actualHash || ''}`);
    await this.client.executeAtomic({
      commandId: `journal-issue:${id}`,
      label: 'journal-reconciliation-issue',
      statements: [{
        sql: `INSERT INTO journal_reconciliation_issues(
                id,issue_type,journal_id,operation_id,path,expected_hash,actual_hash,detail_json,detected_at
              ) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
        bind: [id, type, journalId, operationId, path, expectedHash, actualHash, stableJson(details), timestamp],
        result: 'changes',
      }],
    });
    return id;
  }

  async reconcile() {
    const report = { resumed: [], externalImports: [], missing: [], duplicateIds: [], orphans: [], quarantined: [] };
    const pending = (await this.client.query({
      sql: `${OP_SELECT} WHERE state IN ('prepared','published') ORDER BY prepared_at,operation_id`, result: 'all',
    })).map(rowToOperation);
    for (const operation of pending) {
      try {
        const result = await this._resume(operation);
        report.resumed.push({ operationId: operation.operationId, status: result.status });
        if (result.status === 'quarantined') report.quarantined.push(operation.operationId);
      } catch (error) {
        report.quarantined.push(operation.operationId);
        await this._quarantine(operation, 'reconciliation-error', { error: error.code || error.message });
      }
    }

    const journals = (await this.client.query({
      sql: `${JOURNAL_SELECT} WHERE document_state='indexed' AND deleted_at IS NULL ORDER BY id`, result: 'all',
    })).map(rowToJournal);
    const referencedPaths = new Set();
    const idsByPath = new Map();
    for (const journal of journals) {
      referencedPaths.add(journal.filePath);
      const text = await this.fileAdapter.readText(journal.filePath);
      if (text == null) {
        const issueId = await this._recordIssue('indexed-file-missing', {
          journalId: journal.id, path: journal.filePath, expectedHash: journal.contentHash,
        });
        report.missing.push({ journalId: journal.id, path: journal.filePath, issueId });
        continue;
      }
      try {
        const compact = await hashCompactJournal(text, { path: journal.filePath });
        const paths = idsByPath.get(compact.id) || [];
        paths.push(journal.filePath);
        idsByPath.set(compact.id, paths);
        if (compact.id !== journal.id) {
          const issueId = await this._recordIssue('indexed-id-mismatch', {
            journalId: journal.id, path: journal.filePath, expectedHash: journal.contentHash,
            actualHash: compact.contentHash, details: { documentId: compact.id },
          });
          report.quarantined.push(issueId);
        } else if (compact.contentHash !== journal.contentHash) {
          const imported = await this._importExternal(journal.id, journal.filePath, compact, {
            operationId: `external-reconcile:${journal.id}:${compact.contentHash.slice(0, 20)}`,
          });
          report.externalImports.push({ journalId: journal.id, status: imported.status, contentHash: compact.contentHash });
        }
      } catch (error) {
        const issueId = await this._recordIssue('indexed-file-invalid', {
          journalId: journal.id, path: journal.filePath, expectedHash: journal.contentHash,
          details: { error: error.code || error.message },
        });
        report.quarantined.push(issueId);
      }
    }

    const activeTargets = new Set(await this.client.query({
      sql: `SELECT target_path FROM journal_file_ops
            WHERE state IN ('prepared','published') AND target_path IS NOT NULL`, result: 'values',
    }));
    const paths = await this.fileAdapter.list('journals/');
    for (const path of paths) {
      if (referencedPaths.has(path) || activeTargets.has(path)) continue;
      let compact = null;
      try { compact = await hashCompactJournal(await this.fileAdapter.readText(path), { path }); }
      catch { /* invalid or unrelated files remain reported as orphans */ }
      const issueId = await this._recordIssue('orphan-file', {
        journalId: compact?.id || null, path, actualHash: compact?.contentHash || null,
      });
      report.orphans.push({ path, journalId: compact?.id || null, issueId });
      if (compact?.id) {
        const duplicate = journals.find((journal) => journal.id === compact.id);
        if (duplicate) {
          const duplicateIssue = await this._recordIssue('duplicate-id', {
            journalId: compact.id, path, actualHash: compact.contentHash,
            details: { indexedPath: duplicate.filePath },
          });
          report.duplicateIds.push({ journalId: compact.id, path, indexedPath: duplicate.filePath, issueId: duplicateIssue });
        }
      }
    }
    return report;
  }

  async listOpenIssues() {
    return this.client.query({
      sql: `SELECT id,issue_type AS issueType,journal_id AS journalId,operation_id AS operationId,
                   path,expected_hash AS expectedHash,actual_hash AS actualHash,detail_json AS detailJson,
                   detected_at AS detectedAt
            FROM journal_reconciliation_issues WHERE resolved_at IS NULL
            ORDER BY detected_at,id`,
      result: 'all',
    });
  }
}

export default JournalFileOperationService;
