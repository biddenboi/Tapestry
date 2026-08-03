import { createImportLedgerStatements, fingerprintShadowSource, stableJson, textOrNull } from './shadowDomainUtils.js';
import { sha256Bytes } from '../resources/ResourceOperationService.js';

const IMPORTER_VERSION = 'resources-v2';

export function canonicalResourceBytes(record) {
  if (record?.bytes instanceof Uint8Array) return new Uint8Array(record.bytes);
  if (record?.bytes instanceof ArrayBuffer) return new Uint8Array(record.bytes);
  if (Array.isArray(record?.bytes)) return Uint8Array.from(record.bytes);
  throw Object.assign(new Error('Resource record must contain canonical bytes.'), { code: 'resource-bytes-missing' });
}

export class ResourceShadowImporter {
  constructor({ client, service, now = () => new Date() } = {}) {
    if (!client) throw new Error('ResourceShadowImporter requires a SQLite client.');
    if (!service) throw new Error('ResourceShadowImporter requires a ResourceOperationService.');
    this.client = client;
    this.service = service;
    this.now = now;
  }

  async import({ resources = [], runId = null } = {}) {
    const prepared = [];
    const diagnostics = [];
    for (let index = 0; index < (Array.isArray(resources) ? resources : []).length; index += 1) {
      const record = resources[index] || {};
      try {
        const bytes = canonicalResourceBytes(record);
        const ownerType = textOrNull(record.ownerType);
        const ownerId = textOrNull(record.ownerId);
        const role = textOrNull(record.role);
        const referenceId = textOrNull(record.referenceId);
        if (!ownerType || !ownerId || !role || !referenceId) {
          throw Object.assign(new Error('Resource record is missing canonical ownership fields.'), {
            code: 'resource-ownership-missing',
          });
        }
        const hash = await sha256Bytes(bytes);
        prepared.push({
          record,
          bytes,
          hash,
          declaredMime: textOrNull(record.mimeType),
          ownerType,
          ownerId,
          role,
          referenceId,
        });
      } catch (error) {
        diagnostics.push({ kind: 'resource', sourceIndex: index, recordId: textOrNull(record.UUID), reason: error.code || 'resource-decode-failed' });
      }
    }
    prepared.sort((left, right) => `${left.hash}:${left.referenceId}`.localeCompare(`${right.hash}:${right.referenceId}`));
    const sourceDescriptor = prepared.map((entry) => ({
      hash: entry.hash,
      ownerType: entry.ownerType,
      ownerId: entry.ownerId,
      role: entry.role,
      referenceId: entry.referenceId,
      declaredMime: entry.declaredMime,
    }));
    const sourceFingerprint = await fingerprintShadowSource({ sourceDescriptor, diagnostics });
    const existing = await this.client.query({
      sql: `SELECT run_id AS runId,counts_json AS countsJson,diagnostics_json AS diagnosticsJson
            FROM shadow_import_runs WHERE domain='resources' AND source_fingerprint=? AND importer_version=?`,
      bind: [sourceFingerprint, IMPORTER_VERSION], result: 'one',
    });
    if (existing) return {
      duplicate: true,
      runId: existing.runId,
      sourceFingerprint,
      counts: JSON.parse(existing.countsJson),
      diagnostics: JSON.parse(existing.diagnosticsJson),
    };

    let indexed = 0;
    let quarantined = 0;
    for (const entry of prepared) {
      const operationId = `resource-import:${sourceFingerprint.slice(0, 16)}:${entry.referenceId}`;
      const result = await this.service.promote(entry.bytes, {
        operationId,
        ownerType: entry.ownerType,
        ownerId: entry.ownerId,
        role: entry.role,
        referenceId: entry.referenceId,
        declaredMime: entry.declaredMime,
        metadata: { sourceRecordId: textOrNull(entry.record.UUID), sourceHash: entry.hash },
      });
      if (result.status === 'indexed') indexed += 1;
      else if (result.status === 'quarantined') {
        quarantined += 1;
        diagnostics.push({ kind: 'resource', recordId: textOrNull(entry.record.UUID), reason: result.operation?.errorCode || 'quarantined' });
      }
    }
    const uniqueResources = Number(await this.client.query({ sql: "SELECT COUNT(*) FROM resources WHERE state='active'", result: 'value' }));
    const counts = { input: resources.length, references: indexed, uniqueResources, quarantined, diagnostics: diagnostics.length };
    const timestamp = this.now().toISOString();
    const effectiveRunId = runId || `resources:${sourceFingerprint.slice(0, 24)}`;
    await this.client.executeAtomic({
      commandId: `shadow-import:${effectiveRunId}`,
      label: 'resources-shadow-import-ledger',
      statements: createImportLedgerStatements({
        runId: effectiveRunId,
        domain: 'resources',
        sourceFingerprint,
        importerVersion: IMPORTER_VERSION,
        startedAt: timestamp,
        finishedAt: timestamp,
        counts,
        diagnostics,
      }),
    });
    return { duplicate: false, runId: effectiveRunId, sourceFingerprint, counts, diagnostics };
  }
}

export default ResourceShadowImporter;
