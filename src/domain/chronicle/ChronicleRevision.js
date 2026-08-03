import { sha256Text } from '../../data/persistence/sqlite/migrationChecksum.js';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function canonicalRevisionContent({
  title = '',
  subtitle = '',
  body = '',
  images = [],
  entryKind = 'entry',
} = {}) {
  return JSON.stringify(stable({
    title: String(title || '').trim(),
    subtitle: String(subtitle || ''),
    body: String(body || ''),
    images: Array.isArray(images) ? images : [],
    entryKind: String(entryKind || 'entry'),
  }));
}

export function revisionUUID(entryUUID, revisionNumber) {
  return `entry-revision:${entryUUID}:${revisionNumber}`;
}

export async function createChronicleRevision({
  entryUUID,
  revisionNumber,
  baseRevisionNumber = Math.max(0, Number(revisionNumber) - 1),
  ownerUUID,
  editorUUID,
  title = '',
  subtitle = '',
  body = '',
  images = [],
  entryKind = 'entry',
  editSummary = '',
  clientOperationId,
  origin = 'local',
  createdAt = new Date().toISOString(),
  authoritativeAt = createdAt,
} = {}) {
  if (!entryUUID || !ownerUUID || !editorUUID || !clientOperationId) {
    throw new Error('Entry revisions require Entry, owner, editor, and operation identity.');
  }
  const number = Math.max(1, Number(revisionNumber) || 1);
  const contentHash = await sha256Text(canonicalRevisionContent({
    title, subtitle, body, images, entryKind,
  }));
  return {
    UUID: revisionUUID(entryUUID, number),
    entryUUID,
    revisionNumber: number,
    baseRevisionNumber: Math.max(0, Number(baseRevisionNumber) || 0),
    ownerUUID,
    editorUUID,
    parent: ownerUUID,
    title: String(title || '').trim(),
    subtitle: String(subtitle || ''),
    body: String(body || ''),
    images: Array.isArray(images) ? images : [],
    entryKind,
    contentHash,
    editSummary: String(editSummary || '').trim(),
    clientOperationId,
    origin,
    createdAt,
    authoritativeAt,
    updatedAt: authoritativeAt,
  };
}

