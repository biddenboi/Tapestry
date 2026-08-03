import { stableJson } from '../sqlite/shadowDomainUtils.js';
import { sha256Text } from '../sqlite/migrationChecksum.js';
import {
  resourceQuarantinePath,
  resourceStagingPath,
  resourceStoragePath,
  validateResourcePath,
} from './ResourceFileAdapters.js';

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

function cloneBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  throw new TypeError('Resource input must be bytes.');
}

export async function sha256Bytes(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 support is required for resources.');
  const payload = cloneBytes(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', payload);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

export function detectResourceType(value) {
  const bytes = cloneBytes(value);
  if (bytes.byteLength >= 8
    && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG'
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.byteLength >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) {
    return { mimeType: 'image/gif', extension: 'gif' };
  }
  if (bytes.byteLength >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}

export function validateResourceBytes(value, { declaredMime = null, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const bytes = cloneBytes(value);
  if (!bytes.byteLength) {
    const error = new Error('Resource bytes are empty.');
    error.code = 'resource-empty';
    throw error;
  }
  if (bytes.byteLength > maxBytes) {
    const error = new Error(`Resource exceeds the ${maxBytes}-byte limit.`);
    error.code = 'resource-too-large';
    throw error;
  }
  const detected = detectResourceType(bytes);
  if (!detected) {
    const error = new Error('Resource signature is not an allowed image type.');
    error.code = 'resource-signature-invalid';
    throw error;
  }
  if (declaredMime && String(declaredMime).toLowerCase() !== detected.mimeType) {
    const error = new Error(`Declared MIME ${declaredMime} does not match ${detected.mimeType}.`);
    error.code = 'resource-mime-mismatch';
    error.detectedMime = detected.mimeType;
    throw error;
  }
  return { bytes, ...detected };
}

function operationFromRow(row) {
  if (!row) return null;
  return {
    operationId: row.operationId,
    operationType: row.operationType,
    state: row.state,
    resourceHash: row.resourceHash,
    stagingPath: row.stagingPath,
    targetPath: row.targetPath,
    mimeType: row.mimeType,
    byteSize: row.byteSize == null ? null : Number(row.byteSize),
    referenceId: row.referenceId,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    role: row.role,
    metadata: row.metadataJson ? JSON.parse(row.metadataJson) : {},
    errorCode: row.errorCode,
  };
}

const OP_SELECT = `
SELECT operation_id AS operationId,operation_type AS operationType,state,
       resource_hash AS resourceHash,staging_path AS stagingPath,target_path AS targetPath,
       mime_type AS mimeType,byte_size AS byteSize,reference_id AS referenceId,
       owner_type AS ownerType,owner_id AS ownerId,role,metadata_json AS metadataJson,error_code AS errorCode
FROM resource_file_ops`;

export class ResourceOperationService {
  constructor({
    client,
    fileAdapter,
    now = () => new Date(),
    retentionMs = DEFAULT_RETENTION_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    phaseHook = null,
  } = {}) {
    if (!client) throw new Error('ResourceOperationService requires a SQLite client.');
    if (!fileAdapter) throw new Error('ResourceOperationService requires a resource file adapter.');
    this.client = client;
    this.fileAdapter = fileAdapter;
    this.now = now;
    this.retentionMs = retentionMs;
    this.maxBytes = maxBytes;
    this.phaseHook = phaseHook;
  }

  async _phase(name, context) {
    if (this.phaseHook) await this.phaseHook(name, context);
  }

  async getOperation(operationId) {
    return operationFromRow(await this.client.query({
      sql: `${OP_SELECT} WHERE operation_id=?`, bind: [operationId], result: 'one',
    }));
  }

  async getResource(hash) {
    const row = await this.client.query({
      sql: `SELECT content_hash AS contentHash,mime_type AS mimeType,byte_size AS byteSize,
                   extension,storage_path AS storagePath,state,created_at AS createdAt,
                   verified_at AS verifiedAt,quarantine_reason AS quarantineReason,metadata_json AS metadataJson
            FROM resources WHERE content_hash=?`,
      bind: [hash], result: 'one',
    });
    return row ? { ...row, byteSize: Number(row.byteSize), metadata: JSON.parse(row.metadataJson || '{}') } : null;
  }

  async listReferences(hash, { includeDeleted = false } = {}) {
    const rows = await this.client.query({
      sql: `SELECT id,resource_hash AS resourceHash,owner_type AS ownerType,owner_id AS ownerId,role,
                   created_at AS createdAt,deleted_at AS deletedAt,metadata_json AS metadataJson
            FROM resource_references WHERE resource_hash=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
            ORDER BY owner_type,owner_id,role,id`,
      bind: [hash], result: 'all',
    });
    return rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadataJson || '{}') }));
  }

  async promote(value, {
    operationId,
    ownerType,
    ownerId,
    role,
    referenceId = null,
    declaredMime = null,
    metadata = {},
  } = {}) {
    if (!operationId) throw new Error('Resource promotion requires an operation ID.');
    if (!ownerType || !ownerId || !role) throw new Error('Resource promotion requires ownerType, ownerId, and role.');
    const existing = await this.getOperation(operationId);
    if (existing) return this._resume(existing);

    let validated;
    try {
      validated = validateResourceBytes(value, { declaredMime, maxBytes: this.maxBytes });
    } catch (error) {
      if (error.code === 'resource-too-large') throw error;
      return this._quarantineInput(value, {
        operationId, ownerType, ownerId, role, referenceId, declaredMime, metadata, error,
      });
    }
    const resourceHash = await sha256Bytes(validated.bytes);
    const targetPath = resourceStoragePath(resourceHash, validated.extension);
    const stagingPath = resourceStagingPath(operationId, resourceHash, validated.extension);
    const effectiveReferenceId = referenceId || `${ownerType}:${ownerId}:${role}`;
    const metadataJson = stableJson(metadata || {});
    if (encoder.encode(metadataJson).byteLength > 65536) {
      const error = new Error('Resource metadata exceeds 64 KiB.');
      error.code = 'resource-metadata-too-large';
      throw error;
    }

    const already = await this.getResource(resourceHash);
    if (already?.state === 'active') {
      const existingBytes = await this.fileAdapter.readBytes(already.storagePath);
      if (existingBytes && await sha256Bytes(existingBytes) === resourceHash) {
        const timestamp = this.now().toISOString();
        await this.client.executeAtomic({
          commandId: `resource-deduplicate:${operationId}`,
          label: 'resource-deduplicate-reference',
          statements: [{
            sql: `INSERT INTO resource_file_ops(
                    operation_id,operation_type,state,resource_hash,target_path,mime_type,byte_size,
                    reference_id,owner_type,owner_id,role,metadata_json,prepared_at,published_at,indexed_at
                  ) VALUES(?,'promote','indexed',?,?,?,?,?,?,?,?,?,?,?,?)`,
            bind: [operationId, resourceHash, already.storagePath, already.mimeType, already.byteSize,
              effectiveReferenceId, ownerType, ownerId, role, metadataJson, timestamp, timestamp, timestamp],
            result: 'changes',
          }, {
            sql: `INSERT INTO resource_references(id,resource_hash,owner_type,owner_id,role,created_at,metadata_json)
                  VALUES(?,?,?,?,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET
                    resource_hash=excluded.resource_hash,owner_type=excluded.owner_type,owner_id=excluded.owner_id,
                    role=excluded.role,deleted_at=NULL,metadata_json=excluded.metadata_json`,
            bind: [effectiveReferenceId, resourceHash, ownerType, ownerId, role, timestamp, metadataJson],
            result: 'changes',
          }, {
            sql: 'DELETE FROM resource_gc_candidates WHERE resource_hash=?', bind: [resourceHash], result: 'changes',
          }],
        });
        return { status: 'indexed', duplicateBytes: true, operation: await this.getOperation(operationId), resource: already };
      }
    }

    await this.fileAdapter.writeBytes(stagingPath, validated.bytes);
    const staged = await this.fileAdapter.readBytes(stagingPath);
    if (!staged || await sha256Bytes(staged) !== resourceHash) throw new Error('Staged resource hash verification failed.');
    await this._phase('after-stage-write', { operationId, resourceHash, stagingPath });

    const timestamp = this.now().toISOString();
    await this.client.executeAtomic({
      commandId: `resource-op-prepare:${operationId}`,
      label: 'resource-file-op-prepare',
      statements: [{
        sql: `INSERT INTO resource_file_ops(
                operation_id,operation_type,state,resource_hash,staging_path,target_path,mime_type,byte_size,
                reference_id,owner_type,owner_id,role,metadata_json,prepared_at
              ) VALUES(?,'promote','prepared',?,?,?,?,?,?,?,?,?,?,?)`,
        bind: [operationId, resourceHash, stagingPath, targetPath, validated.mimeType, validated.bytes.byteLength,
          effectiveReferenceId, ownerType, ownerId, role, metadataJson, timestamp], result: 'changes',
      }],
    });
    const operation = await this.getOperation(operationId);
    await this._phase('after-prepare', { operation });
    return this._resume(operation);
  }

  async _quarantineInput(value, { operationId, ownerType, ownerId, role, referenceId, declaredMime, metadata, error }) {
    const bytes = cloneBytes(value);
    const hash = await sha256Bytes(bytes);
    const detected = detectResourceType(bytes);
    const extension = detected?.extension || 'bin';
    const quarantinePath = resourceQuarantinePath(operationId, hash, extension);
    await this.fileAdapter.writeBytes(quarantinePath, bytes);
    const timestamp = this.now().toISOString();
    const effectiveReferenceId = referenceId || `${ownerType}:${ownerId}:${role}`;
    const detail = stableJson({ declaredMime, detectedMime: detected?.mimeType || null, message: error.message });
    await this.client.executeAtomic({
      commandId: `resource-quarantine:${operationId}`,
      label: 'resource-quarantine',
      statements: [{
        sql: `INSERT INTO resources(
                content_hash,mime_type,byte_size,extension,storage_path,state,created_at,quarantined_at,quarantine_reason,metadata_json
              ) VALUES(?,?,?,?,?,'quarantined',?,?,?,?)
              ON CONFLICT(content_hash) DO UPDATE SET
                state='quarantined',storage_path=excluded.storage_path,quarantined_at=excluded.quarantined_at,
                quarantine_reason=excluded.quarantine_reason`,
        bind: [hash, detected?.mimeType || 'application/octet-stream', bytes.byteLength, detected?.extension || 'bin', quarantinePath,
          timestamp, timestamp, error.code || 'resource-invalid', stableJson(metadata || {})], result: 'changes',
      }, {
        sql: `INSERT INTO resource_file_ops(
                operation_id,operation_type,state,resource_hash,target_path,mime_type,byte_size,reference_id,
                owner_type,owner_id,role,metadata_json,prepared_at,indexed_at,error_code,error_detail_json
              ) VALUES(?,'quarantine','quarantined',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        bind: [operationId, hash, quarantinePath, detected?.mimeType || null, bytes.byteLength, effectiveReferenceId,
          ownerType, ownerId, role, stableJson(metadata || {}), timestamp, timestamp, error.code || 'resource-invalid', detail],
        result: 'changes',
      }],
    });
    await this._recordIssue(error.code || 'resource-invalid', {
      resourceHash: hash, operationId, path: quarantinePath, details: JSON.parse(detail),
    });
    return { status: 'quarantined', operation: await this.getOperation(operationId), resource: await this.getResource(hash) };
  }

  async _resume(operation) {
    if (!operation) return { status: 'missing-operation' };
    if (['indexed', 'quarantined', 'cancelled'].includes(operation.state)) {
      return { status: operation.state, operation, resource: operation.resourceHash ? await this.getResource(operation.resourceHash) : null };
    }
    if (operation.operationType !== 'promote') return { status: operation.state, operation };

    let current = operation;
    if (current.state === 'prepared') {
      const staged = await this.fileAdapter.readBytes(current.stagingPath);
      if (!staged) return this._quarantineOperation(current, 'resource-staging-missing', { path: current.stagingPath });
      const stagedHash = await sha256Bytes(staged);
      if (stagedHash !== current.resourceHash || staged.byteLength !== current.byteSize) {
        return this._quarantineOperation(current, 'resource-staging-changed', {
          path: current.stagingPath, expectedHash: current.resourceHash, actualHash: stagedHash,
        });
      }
      const existing = await this.fileAdapter.readBytes(current.targetPath);
      if (existing) {
        const existingHash = await sha256Bytes(existing);
        if (existingHash !== current.resourceHash) {
          return this._quarantineOperation(current, 'resource-target-collision', {
            path: current.targetPath, expectedHash: current.resourceHash, actualHash: existingHash,
          });
        }
      } else {
        await this.fileAdapter.writeBytes(current.targetPath, staged);
      }
      const published = await this.fileAdapter.readBytes(current.targetPath);
      if (!published || await sha256Bytes(published) !== current.resourceHash) {
        return this._quarantineOperation(current, 'resource-publish-verification-failed', { path: current.targetPath });
      }
      await this._phase('after-file-publish', { operation: current });
      const timestamp = this.now().toISOString();
      await this.client.executeAtomic({
        commandId: `resource-op-published:${current.operationId}`,
        label: 'resource-file-op-published',
        statements: [{
          sql: "UPDATE resource_file_ops SET state='published',published_at=? WHERE operation_id=? AND state='prepared'",
          bind: [timestamp, current.operationId], result: 'changes',
        }],
      });
      current = await this.getOperation(current.operationId);
      await this._phase('after-published-state', { operation: current });
    }

    if (current.state === 'published') {
      const published = await this.fileAdapter.readBytes(current.targetPath);
      if (!published) return this._quarantineOperation(current, 'resource-published-file-missing', { path: current.targetPath });
      const actualHash = await sha256Bytes(published);
      if (actualHash !== current.resourceHash || published.byteLength !== current.byteSize) {
        return this._quarantineOperation(current, 'resource-published-file-changed', {
          path: current.targetPath, expectedHash: current.resourceHash, actualHash,
        });
      }
      const timestamp = this.now().toISOString();
      const extension = current.targetPath.split('.').pop();
      await this.client.executeAtomic({
        commandId: `resource-op-index:${current.operationId}`,
        label: 'resource-file-op-index',
        statements: [{
          sql: `INSERT INTO resources(
                  content_hash,mime_type,byte_size,extension,storage_path,state,created_at,verified_at,metadata_json
                ) VALUES(?,?,?,?,?,'active',?,?,?)
                ON CONFLICT(content_hash) DO UPDATE SET
                  mime_type=excluded.mime_type,byte_size=excluded.byte_size,extension=excluded.extension,
                  storage_path=excluded.storage_path,state='active',verified_at=excluded.verified_at,
                  quarantined_at=NULL,quarantine_reason=NULL`,
          bind: [current.resourceHash, current.mimeType, current.byteSize, extension, current.targetPath,
            timestamp, timestamp, stableJson(current.metadata || {})], result: 'changes',
        }, {
          sql: `INSERT INTO resource_references(id,resource_hash,owner_type,owner_id,role,created_at,metadata_json)
                VALUES(?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                  resource_hash=excluded.resource_hash,owner_type=excluded.owner_type,owner_id=excluded.owner_id,
                  role=excluded.role,deleted_at=NULL,metadata_json=excluded.metadata_json`,
          bind: [current.referenceId, current.resourceHash, current.ownerType, current.ownerId, current.role,
            timestamp, stableJson(current.metadata || {})], result: 'changes',
        }, {
          sql: "UPDATE resource_file_ops SET state='indexed',indexed_at=? WHERE operation_id=? AND state='published'",
          bind: [timestamp, current.operationId], result: 'changes',
        }, {
          sql: 'DELETE FROM resource_gc_candidates WHERE resource_hash=?', bind: [current.resourceHash], result: 'changes',
        }],
      });
      current = await this.getOperation(current.operationId);
      await this.fileAdapter.remove(current.stagingPath).catch(() => false);
      await this._phase('after-index', { operation: current });
    }
    return { status: current.state, operation: current, resource: await this.getResource(current.resourceHash) };
  }

  async _quarantineOperation(operation, code, details = {}) {
    const timestamp = this.now().toISOString();
    await this.client.executeAtomic({
      commandId: `resource-op-quarantine:${operation.operationId}:${code}`,
      label: 'resource-file-op-quarantine',
      statements: [{
        sql: `UPDATE resource_file_ops SET state='quarantined',error_code=?,error_detail_json=?,indexed_at=?
              WHERE operation_id=? AND state NOT IN ('indexed','quarantined','cancelled')`,
        bind: [code, stableJson(details), timestamp, operation.operationId], result: 'changes',
      }],
    });
    await this._recordIssue(code, {
      resourceHash: operation.resourceHash, operationId: operation.operationId,
      path: details.path || operation.targetPath || operation.stagingPath, details,
    });
    return { status: 'quarantined', operation: await this.getOperation(operation.operationId), resource: await this.getResource(operation.resourceHash) };
  }

  async dereference({ operationId, ownerType, ownerId, role } = {}) {
    if (!operationId) throw new Error('Resource dereference requires an operation ID.');
    const existing = await this.getOperation(operationId);
    if (existing) return { status: existing.state, operation: existing };
    const reference = await this.client.query({
      sql: `SELECT id,resource_hash AS resourceHash FROM resource_references
            WHERE owner_type=? AND owner_id=? AND role=? AND deleted_at IS NULL`,
      bind: [ownerType, ownerId, role], result: 'one',
    });
    if (!reference) return { status: 'missing-reference' };
    const resource = await this.getResource(reference.resourceHash);
    const timestamp = this.now().toISOString();
    const eligibleAfter = new Date(this.now().getTime() + this.retentionMs).toISOString();
    await this.client.executeAtomic({
      commandId: `resource-dereference:${operationId}`,
      label: 'resource-dereference',
      statements: [{
        sql: `INSERT INTO resource_file_ops(
                operation_id,operation_type,state,resource_hash,target_path,reference_id,owner_type,owner_id,role,
                metadata_json,prepared_at,indexed_at
              ) VALUES(?,'dereference','indexed',?,?,?,?,?,?,'{}',?,?)`,
        bind: [operationId, reference.resourceHash, resource?.storagePath || null, reference.id,
          ownerType, ownerId, role, timestamp, timestamp], result: 'changes',
      }, {
        sql: 'UPDATE resource_references SET deleted_at=? WHERE id=? AND deleted_at IS NULL',
        bind: [timestamp, reference.id], result: 'changes',
      }, {
        sql: `INSERT INTO resource_reference_tombstones(
                reference_id,resource_hash,owner_type,owner_id,role,tombstoned_at,operation_id
              ) VALUES(?,?,?,?,?,?,?) ON CONFLICT(reference_id) DO NOTHING`,
        bind: [reference.id, reference.resourceHash, ownerType, ownerId, role, timestamp, operationId], result: 'changes',
      }, {
        sql: `INSERT INTO resource_gc_candidates(resource_hash,storage_path,reason,eligible_after,created_at)
              SELECT r.content_hash,r.storage_path,'unreferenced',?,?
              FROM resources r
              WHERE r.content_hash=? AND r.state='active'
                AND NOT EXISTS(SELECT 1 FROM resource_references rr WHERE rr.resource_hash=r.content_hash AND rr.deleted_at IS NULL)
              ON CONFLICT(resource_hash) DO UPDATE SET
                eligible_after=excluded.eligible_after,reason=excluded.reason`,
        bind: [eligibleAfter, timestamp, reference.resourceHash], result: 'changes',
      }],
    });
    return { status: 'indexed', operation: await this.getOperation(operationId), resourceHash: reference.resourceHash };
  }

  async pinBackup(backupId, resourceHashes, { retainedUntil } = {}) {
    if (!backupId || !retainedUntil) throw new Error('Backup pins require backupId and retainedUntil.');
    const timestamp = this.now().toISOString();
    const statements = [...new Set(resourceHashes || [])].sort().map((hash) => ({
      sql: `INSERT INTO resource_backup_pins(backup_id,resource_hash,retained_until,created_at)
            VALUES(?,?,?,?)
            ON CONFLICT(backup_id,resource_hash) DO UPDATE SET retained_until=excluded.retained_until`,
      bind: [backupId, hash, retainedUntil, timestamp], result: 'changes',
    }));
    if (!statements.length) return { pinned: 0 };
    await this.client.executeAtomic({ commandId: `resource-backup-pin:${backupId}`, label: 'resource-backup-pin', statements });
    return { pinned: statements.length };
  }

  async markAndSweep({ now = this.now() } = {}) {
    const timestamp = (now instanceof Date ? now : new Date(now)).toISOString();
    await this.client.executeAtomic({
      commandId: `resource-gc-mark:${timestamp}`,
      label: 'resource-gc-mark',
      statements: [{
        sql: `INSERT INTO resource_gc_candidates(resource_hash,storage_path,reason,eligible_after,created_at)
              SELECT r.content_hash,r.storage_path,'unreferenced',?,?
              FROM resources r
              WHERE r.state='active'
                AND NOT EXISTS(SELECT 1 FROM resource_references rr WHERE rr.resource_hash=r.content_hash AND rr.deleted_at IS NULL)
                AND NOT EXISTS(SELECT 1 FROM resource_file_ops op WHERE op.resource_hash=r.content_hash AND op.state IN ('prepared','published'))
              ON CONFLICT(resource_hash) DO NOTHING`,
        bind: [new Date(new Date(timestamp).getTime() + this.retentionMs).toISOString(), timestamp], result: 'changes',
      }],
    });
    const candidates = await this.client.query({
      sql: `SELECT c.resource_hash AS resourceHash,c.storage_path AS storagePath
            FROM resource_gc_candidates c JOIN resources r ON r.content_hash=c.resource_hash
            WHERE c.eligible_after<=? AND r.state='active'
              AND NOT EXISTS(SELECT 1 FROM resource_references rr WHERE rr.resource_hash=c.resource_hash AND rr.deleted_at IS NULL)
              AND NOT EXISTS(SELECT 1 FROM resource_file_ops op WHERE op.resource_hash=c.resource_hash AND op.state IN ('prepared','published','quarantined'))
              AND NOT EXISTS(SELECT 1 FROM resource_backup_pins bp WHERE bp.resource_hash=c.resource_hash AND bp.retained_until>?)
            ORDER BY c.resource_hash`,
      bind: [timestamp, timestamp], result: 'all',
    });
    const removed = [];
    for (const candidate of candidates) {
      const didRemove = await this.fileAdapter.remove(candidate.storagePath);
      const verifiedMissing = (await this.fileAdapter.readBytes(candidate.storagePath)) == null;
      if (!verifiedMissing) {
        await this._recordIssue('resource-gc-remove-failed', {
          resourceHash: candidate.resourceHash, path: candidate.storagePath,
        });
        continue;
      }
      await this.client.executeAtomic({
        commandId: `resource-gc-sweep:${candidate.resourceHash}:${timestamp}`,
        label: 'resource-gc-sweep',
        statements: [{
          sql: "UPDATE resources SET state='garbage',verified_at=? WHERE content_hash=? AND state='active'",
          bind: [timestamp, candidate.resourceHash], result: 'changes',
        }, {
          sql: 'DELETE FROM resource_gc_candidates WHERE resource_hash=?',
          bind: [candidate.resourceHash], result: 'changes',
        }],
      });
      removed.push({ ...candidate, didRemove });
    }
    return { removed };
  }

  async reconcile() {
    const pendingRows = await this.client.query({
      sql: `${OP_SELECT} WHERE state IN ('prepared','published') ORDER BY prepared_at,operation_id`, result: 'all',
    });
    const resumed = [];
    for (const row of pendingRows) resumed.push(await this._resume(operationFromRow(row)));

    const active = await this.client.query({
      sql: "SELECT content_hash AS resourceHash,storage_path AS storagePath FROM resources WHERE state='active' ORDER BY content_hash",
      result: 'all',
    });
    const missing = [];
    for (const row of active) {
      const bytes = await this.fileAdapter.readBytes(row.storagePath);
      if (!bytes) {
        missing.push(row);
        await this._recordIssue('resource-file-missing', { resourceHash: row.resourceHash, path: row.storagePath });
      } else {
        const actualHash = await sha256Bytes(bytes);
        if (actualHash !== row.resourceHash) {
          await this._recordIssue('resource-file-changed', {
            resourceHash: row.resourceHash, path: row.storagePath, details: { actualHash },
          });
        }
      }
    }

    const known = new Set([
      ...active.map((row) => row.storagePath),
      ...(await this.client.query({ sql: 'SELECT target_path FROM resource_file_ops WHERE target_path IS NOT NULL', result: 'values' })),
      ...(await this.client.query({ sql: 'SELECT staging_path FROM resource_file_ops WHERE staging_path IS NOT NULL', result: 'values' })),
    ]);
    const files = await this.fileAdapter.list('resources/');
    const orphans = [];
    for (const path of files) {
      if (known.has(path) || path.includes('/.quarantine/')) continue;
      orphans.push(path);
      await this._recordIssue('resource-orphan-file', { path });
    }
    return { resumed, missing, orphans };
  }

  async listOpenIssues() {
    const rows = await this.client.query({
      sql: `SELECT id,issue_type AS issueType,resource_hash AS resourceHash,operation_id AS operationId,
                   path,detail_json AS detailJson,detected_at AS detectedAt
            FROM resource_reconciliation_issues WHERE resolved_at IS NULL
            ORDER BY detected_at,id`,
      result: 'all',
    });
    return rows.map((row) => ({ ...row, details: JSON.parse(row.detailJson || '{}') }));
  }

  async _recordIssue(type, { resourceHash = null, operationId = null, path = null, details = {} } = {}) {
    const timestamp = this.now().toISOString();
    const id = await sha256Text(`resource-issue:${type}:${resourceHash || ''}:${operationId || ''}:${path || ''}:${stableJson(details)}`);
    await this.client.executeAtomic({
      commandId: `resource-issue:${id}`,
      label: 'resource-reconciliation-issue',
      statements: [{
        sql: `INSERT INTO resource_reconciliation_issues(
                id,issue_type,resource_hash,operation_id,path,detail_json,detected_at
              ) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
        bind: [id, type, resourceHash, operationId, path ? validateResourcePath(path) : null, stableJson(details), timestamp],
        result: 'changes',
      }],
    });
    return id;
  }
}

export default ResourceOperationService;
