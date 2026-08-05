import {
  SQLITE_DOCUMENT_RANGE_FIELDS,
  documentTableForStore,
  projectDocumentRecord,
} from './documentStores.js';
import { SQLITE_ERROR_CODES, SqliteRuntimeError } from './sqliteErrors.js';
import { sha256Bytes } from '../resources/ResourceOperationService.js';

const RESOURCE_STORE = 'resources';

const operationId = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${uuid}`;
};

function parseRecord(row) {
  if (!row?.recordJson) return null;
  const record = JSON.parse(String(row.recordJson));
  if (row.resourcePayload == null) return record;
  const bytes = row.resourcePayload instanceof Uint8Array
    ? new Uint8Array(row.resourcePayload)
    : new Uint8Array(row.resourcePayload);
  return {
    ...record,
    hash: record.hash || row.resourceHash || null,
    mimeType: record.mimeType || row.resourceMimeType || 'application/octet-stream',
    ...(typeof Blob === 'undefined'
      ? { bytes }
      : { blob: new Blob([bytes], { type: row.resourceMimeType || record.mimeType || 'application/octet-stream' }) }),
  };
}

function putStatement(store, projected) {
  const table = documentTableForStore(store);
  return {
    sql: `
INSERT INTO ${table}(
  uuid,record_json,parent_uuid,created_at,updated_at,in_game_timestamp,sort_key,sequence
) VALUES(?,?,?,?,?,?,?,(SELECT COALESCE(MAX(sequence),0)+1 FROM ${table}))
ON CONFLICT(uuid) DO UPDATE SET
  record_json=excluded.record_json,
  parent_uuid=excluded.parent_uuid,
  created_at=excluded.created_at,
  updated_at=excluded.updated_at,
  in_game_timestamp=excluded.in_game_timestamp,
  sort_key=excluded.sort_key
`.trim(),
    bind: [
      projected.uuid,
      projected.recordJson,
      projected.parentUuid,
      projected.createdAt,
      projected.updatedAt,
      projected.inGameTimestamp,
      projected.sortKey,
    ],
    result: 'changes',
  };
}

function decodeDataUrl(value) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(value || ''));
  if (!match) return null;
  const [, mimeType = 'application/octet-stream', base64Flag, payload] = match;
  if (!base64Flag) {
    return {
      bytes: new TextEncoder().encode(decodeURIComponent(payload)),
      mimeType,
    };
  }
  const decoded = atob(payload.replace(/\s/g, ''));
  return {
    bytes: Uint8Array.from(decoded, (character) => character.charCodeAt(0)),
    mimeType,
  };
}

async function prepareResourcePayload(record) {
  let bytes = null;
  let mimeType = record?.mimeType || null;
  if (typeof Blob !== 'undefined' && record?.blob instanceof Blob) {
    bytes = new Uint8Array(await record.blob.arrayBuffer());
    mimeType ||= record.blob.type || null;
  } else if (record?.bytes instanceof Uint8Array) {
    bytes = new Uint8Array(record.bytes);
  } else if (record?.bytes instanceof ArrayBuffer) {
    bytes = new Uint8Array(record.bytes.slice(0));
  } else if (ArrayBuffer.isView(record?.bytes)) {
    bytes = new Uint8Array(
      record.bytes.buffer.slice(
        record.bytes.byteOffset,
        record.bytes.byteOffset + record.bytes.byteLength,
      ),
    );
  } else {
    const decoded = decodeDataUrl(record?.dataUrl ?? record?.dataURL);
    if (decoded) {
      bytes = decoded.bytes;
      mimeType ||= decoded.mimeType;
    }
  }
  if (!bytes?.byteLength) return null;
  const contentHash = await sha256Bytes(bytes);
  const declaredHash = record?.hash || record?.contentHash || null;
  if (declaredHash && declaredHash !== contentHash) {
    throw new Error(`Resource ${record.UUID} does not match its declared content hash.`);
  }
  return {
    bytes,
    contentHash,
    mimeType: mimeType || 'application/octet-stream',
  };
}

function resourceMetadataRecord(record, payload) {
  const {
    blob: _blob,
    bytes: _bytes,
    dataUrl: _dataUrl,
    dataURL: _dataURL,
    ...metadata
  } = record;
  return payload
    ? {
        ...metadata,
        hash: payload.contentHash,
        mimeType: payload.mimeType,
        sizeBytes: Number(metadata.sizeBytes) || payload.bytes.byteLength,
      }
    : metadata;
}

async function preparePut(store, record) {
  if (store !== RESOURCE_STORE) {
    const projected = projectDocumentRecord(record);
    return { projected, statements: [putStatement(store, projected)] };
  }
  const payload = await prepareResourcePayload(record);
  const projected = projectDocumentRecord(resourceMetadataRecord(record, payload));
  const statements = [putStatement(store, projected)];
  if (payload) {
    statements.push({
      sql: `
INSERT INTO document_resource_payloads(
  content_hash,mime_type,byte_size,payload,created_at
) VALUES(?,?,?,?,?)
ON CONFLICT(content_hash) DO UPDATE SET
  mime_type=excluded.mime_type,
  byte_size=excluded.byte_size,
  payload=excluded.payload
`.trim(),
      bind: [
        payload.contentHash,
        payload.mimeType,
        payload.bytes.byteLength,
        payload.bytes,
        record.createdAt || new Date().toISOString(),
      ],
      result: 'changes',
    }, {
      sql: `
INSERT INTO document_resource_payload_refs(resource_uuid,content_hash)
VALUES(?,?)
ON CONFLICT(resource_uuid) DO UPDATE SET
  content_hash=excluded.content_hash
`.trim(),
      bind: [projected.uuid, payload.contentHash],
      result: 'changes',
    });
  }
  return { projected, statements };
}

function selectRecordSql(table, { where = '', order = '' } = {}) {
  if (table !== documentTableForStore(RESOURCE_STORE)) {
    return `SELECT record_json AS recordJson FROM ${table}${where}${order}`;
  }
  return `
SELECT c.record_json AS recordJson,
       p.payload AS resourcePayload,
       p.content_hash AS resourceHash,
       p.mime_type AS resourceMimeType
FROM ${table} AS c
LEFT JOIN document_resource_payload_refs AS pr ON pr.resource_uuid=c.uuid
LEFT JOIN document_resource_payloads AS p ON p.content_hash=pr.content_hash
${where}
${order}
`.trim();
}

export class SqliteDocumentRepository {
  constructor(client) {
    if (!client?.query || !client?.executeAtomic) {
      throw new Error('SqliteDocumentRepository requires a SQLite worker client.');
    }
    this.client = client;
  }

  async get(store, UUID, options) {
    const table = documentTableForStore(store);
    const row = await this.client.query({
      sql: selectRecordSql(table, {
        where: ` WHERE ${store === RESOURCE_STORE ? 'c.' : ''}uuid=?`,
      }),
      bind: [String(UUID)],
      result: 'one',
    }, options);
    return parseRecord(row);
  }

  async getAll(store, options) {
    const table = documentTableForStore(store);
    const rows = await this.client.query({
      sql: selectRecordSql(table, {
        order: ` ORDER BY ${store === RESOURCE_STORE ? 'c.' : ''}sequence`,
      }),
      result: 'all',
    }, options);
    return rows.map(parseRecord);
  }

  async put(store, record, { operationId: requestedOperationId, ...requestOptions } = {}) {
    const prepared = await preparePut(store, record);
    await this.client.executeAtomic({
      commandId: requestedOperationId || operationId(`document-put:${store}:${prepared.projected.uuid}`),
      label: `document-put:${store}`,
      statements: prepared.statements,
    }, requestOptions);
    return prepared.projected.uuid;
  }

  async commitBatch({
    operations = [],
    beforeStatements = [],
    additionalStatements = [],
    afterStatements = [],
    commandId = operationId('document-batch'),
    label = 'document-batch',
  } = {}, requestOptions) {
    const statements = (beforeStatements || []).filter(Boolean);
    for (const operation of operations) {
      if (operation?.type === 'put') {
        const prepared = await preparePut(operation.store, operation.record);
        statements.push(...prepared.statements);
      } else if (operation?.type === 'delete') {
        statements.push({
          sql: `DELETE FROM ${documentTableForStore(operation.store)} WHERE uuid=?`,
          bind: [String(operation.UUID)],
          result: 'changes',
        });
      } else if (operation?.type === 'clear') {
        statements.push({
          sql: `DELETE FROM ${documentTableForStore(operation.store)}`,
          result: 'changes',
        });
      } else {
        throw new Error(`Unsupported SQLite document batch operation: ${operation?.type || 'missing'}`);
      }
    }
    for (const statement of additionalStatements || []) {
      if (statement) statements.push(statement);
    }
    for (const statement of afterStatements || []) {
      if (statement) statements.push(statement);
    }
    if (!statements.length) return { statementResults: [] };
    return this.client.executeAtomic({ commandId, label, statements }, requestOptions);
  }

  async replaceAll(stores, options = {}) {
    const operations = [];
    for (const [store, records] of stores) {
      operations.push({ type: 'clear', store });
      for (const record of records || []) operations.push({ type: 'put', store, record });
    }
    return this.commitBatch({
      operations,
      commandId: options.operationId || operationId('document-replace-all'),
      label: options.label || 'document-replace-all',
    });
  }

  async remove(store, UUID, { operationId: requestedOperationId, ...requestOptions } = {}) {
    const table = documentTableForStore(store);
    const result = await this.client.executeAtomic({
      commandId: requestedOperationId || operationId(`document-remove:${store}:${UUID}`),
      label: `document-remove:${store}`,
      statements: [{
        sql: `DELETE FROM ${table} WHERE uuid=?`,
        bind: [String(UUID)],
        result: 'changes',
      }],
    }, requestOptions);
    return Number(result.statementResults?.[0]?.changes || 0) > 0;
  }

  async clear(store, { operationId: requestedOperationId, ...requestOptions } = {}) {
    const table = documentTableForStore(store);
    const result = await this.client.executeAtomic({
      commandId: requestedOperationId || operationId(`document-clear:${store}`),
      label: `document-clear:${store}`,
      statements: [{ sql: `DELETE FROM ${table}`, result: 'changes' }],
    }, requestOptions);
    return Number(result.statementResults?.[0]?.changes || 0);
  }

  async range(store, {
    field = 'sortKey',
    lower = null,
    upper = null,
    inclusiveLower = true,
    inclusiveUpper = true,
    direction = 'asc',
    limit = 1000,
  } = {}, options) {
    const table = documentTableForStore(store);
    const column = SQLITE_DOCUMENT_RANGE_FIELDS[field];
    if (!column) {
      throw new SqliteRuntimeError(`Unsupported SQLite document range field: ${field}`, {
        code: SQLITE_ERROR_CODES.invalidRequest,
        details: { field, store },
      });
    }
    const where = [];
    const bind = [];
    if (lower != null) {
      where.push(`${column} ${inclusiveLower ? '>=' : '>'} ?`);
      bind.push(lower);
    }
    if (upper != null) {
      where.push(`${column} ${inclusiveUpper ? '<=' : '<'} ?`);
      bind.push(upper);
    }
    bind.push(Math.max(0, Math.min(10_000, Number(limit) || 0)));
    const rows = await this.client.query({
      sql: selectRecordSql(table, {
        where: where.length ? ` WHERE ${where.join(' AND ')}` : '',
        order: ` ORDER BY ${column} ${direction === 'desc' ? 'DESC' : 'ASC'}, ${store === RESOURCE_STORE ? 'c.' : ''}uuid ${direction === 'desc' ? 'DESC' : 'ASC'} LIMIT ?`,
      }),
      bind,
      result: 'all',
    }, options);
    return rows.map(parseRecord);
  }
}

export default SqliteDocumentRepository;
