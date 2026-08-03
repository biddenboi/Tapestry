import { sha256Text } from '../sqlite/migrationChecksum.js';

export const COMPACT_JOURNAL_FORMAT_VERSION = 1;
export const COMPACT_JOURNAL_LIMITS = Object.freeze({
  documentBytes: 2 * 1024 * 1024,
  frontmatterBytes: 8 * 1024,
  titleBytes: 1024,
  idBytes: 256,
  pathBytes: 1024,
});

const FRONTMATTER_KEYS = Object.freeze(['id', 'player', 'created', 'updated']);
const REQUIRED_KEYS = new Set(['id', 'player', 'created']);
const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

export class JournalDocumentError extends Error {
  constructor(message, { code = 'invalid-journal-document', details = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'JournalDocumentError';
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return String(value ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').normalize('NFC');
}

function byteLength(value) {
  return encoder.encode(String(value)).byteLength;
}

function assertBound(value, maximum, label, code) {
  const size = byteLength(value);
  if (size > maximum) {
    throw new JournalDocumentError(`${label} exceeds the ${maximum}-byte limit.`, {
      code,
      details: { size, maximum },
    });
  }
}

function validateScalar(value, label, { required = true } = {}) {
  const normalized = normalizeText(value).trim();
  if (required && !normalized) {
    throw new JournalDocumentError(`${label} is required.`, { code: `missing-${label}` });
  }
  if (/\p{Cc}/u.test(normalized)) {
    throw new JournalDocumentError(`${label} contains control characters.`, { code: `unsafe-${label}` });
  }
  assertBound(normalized, COMPACT_JOURNAL_LIMITS.idBytes, label, `${label}-too-large`);
  return normalized;
}

function validateTimestamp(value, label, { required = true } = {}) {
  const normalized = normalizeText(value).trim();
  if (!normalized && !required) return null;
  if (!normalized || Number.isNaN(Date.parse(normalized))) {
    throw new JournalDocumentError(`${label} must be a valid timestamp.`, {
      code: `invalid-${label}`,
      details: { value: normalized },
    });
  }
  return normalized;
}

function quoteFrontmatter(value) {
  return JSON.stringify(String(value));
}

function parseFrontmatterScalar(raw, key) {
  const text = String(raw).trim();
  if (!text.startsWith('"')) {
    throw new JournalDocumentError(`Frontmatter value ${key} must be a JSON-quoted string.`, {
      code: 'invalid-frontmatter-value',
      details: { key },
    });
  }
  let value;
  try { value = JSON.parse(text); }
  catch (cause) {
    throw new JournalDocumentError(`Frontmatter value ${key} is not valid JSON string syntax.`, {
      code: 'invalid-frontmatter-value', details: { key }, cause,
    });
  }
  if (typeof value !== 'string') {
    throw new JournalDocumentError(`Frontmatter value ${key} must decode to a string.`, {
      code: 'invalid-frontmatter-value', details: { key },
    });
  }
  return value;
}

export function decodeJournalUtf8(input) {
  if (typeof input === 'string') return normalizeText(input);
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    return normalizeText(fatalDecoder.decode(bytes));
  } catch (cause) {
    throw new JournalDocumentError('Journal bytes are not valid UTF-8.', {
      code: 'invalid-utf8', cause,
    });
  }
}

export function validateJournalPath(path, { allowStaging = false } = {}) {
  const normalized = normalizeText(path).replaceAll('\\', '/').replace(/^\/+/, '');
  assertBound(normalized, COMPACT_JOURNAL_LIMITS.pathBytes, 'Journal path', 'path-too-large');
  if (!normalized || normalized.includes('\0') || /\p{Cc}/u.test(normalized)) {
    throw new JournalDocumentError('Journal path is empty or contains control characters.', { code: 'unsafe-path' });
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new JournalDocumentError('Journal path contains an empty or traversal segment.', {
      code: 'unsafe-path', details: { path: normalized },
    });
  }
  const prefixAllowed = /^journals\/\d{4}\/\d{2}\/\d{2}\/[A-Za-z0-9._-]+\.md$/u.test(normalized);
  const stagingAllowed = allowStaging
    && /^journals\/\.staging\/[A-Za-z0-9._/-]+\.md$/u.test(normalized);
  const versionAllowed = allowStaging
    && /^journals\/\.versions\/[A-Za-z0-9._-]+\/[a-f0-9]{64}\.md$/u.test(normalized);
  if (!prefixAllowed && !stagingAllowed && !versionAllowed) {
    throw new JournalDocumentError('Journal path is outside the supported journal layout.', {
      code: 'unsafe-path', details: { path: normalized },
    });
  }
  return normalized;
}

export function compactJournalTargetPath({ id, created }) {
  const safeId = validateScalar(id, 'id').replace(/[^A-Za-z0-9._-]/gu, '_');
  const date = new Date(validateTimestamp(created, 'created'));
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return validateJournalPath(`journals/${year}/${month}/${day}/${safeId}.md`);
}

export function compactJournalVersionPath(id, contentHash) {
  const safeId = validateScalar(id, 'id').replace(/[^A-Za-z0-9._-]/gu, '_');
  const hash = String(contentHash || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new JournalDocumentError('Versioned journal paths require a SHA-256 hash.', {
      code: 'invalid-content-hash', details: { contentHash },
    });
  }
  return validateJournalPath(`journals/.versions/${safeId}/${hash}.md`, { allowStaging: true });
}

export function serializeCompactJournal({ id, player, created, updated = null, title = '', body = '' } = {}) {
  const document = {
    id: validateScalar(id, 'id'),
    player: validateScalar(player, 'player'),
    created: validateTimestamp(created, 'created'),
    updated: validateTimestamp(updated, 'updated', { required: false }),
    title: normalizeText(title),
    body: normalizeText(body),
  };
  if (document.title.includes('\n')) {
    throw new JournalDocumentError('Journal titles must be a single line.', { code: 'multiline-title' });
  }
  assertBound(document.title, COMPACT_JOURNAL_LIMITS.titleBytes, 'Journal title', 'title-too-large');

  const frontmatterLines = [
    '---',
    `id: ${quoteFrontmatter(document.id)}`,
    `player: ${quoteFrontmatter(document.player)}`,
    `created: ${quoteFrontmatter(document.created)}`,
  ];
  if (document.updated) frontmatterLines.push(`updated: ${quoteFrontmatter(document.updated)}`);
  frontmatterLines.push('---');
  const frontmatter = frontmatterLines.join('\n');
  assertBound(frontmatter, COMPACT_JOURNAL_LIMITS.frontmatterBytes, 'Journal frontmatter', 'frontmatter-too-large');

  const markdown = `${frontmatter}\n# ${document.title}\n\n${document.body}\n`;
  assertBound(markdown, COMPACT_JOURNAL_LIMITS.documentBytes, 'Journal document', 'document-too-large');
  return markdown;
}

export function parseCompactJournal(input, { expectedId = null, path = null } = {}) {
  const markdown = decodeJournalUtf8(input);
  assertBound(markdown, COMPACT_JOURNAL_LIMITS.documentBytes, 'Journal document', 'document-too-large');
  if (!markdown.startsWith('---\n')) {
    throw new JournalDocumentError('Journal document must begin with compact frontmatter.', {
      code: 'missing-frontmatter',
    });
  }
  const closingIndex = markdown.indexOf('\n---\n', 4);
  if (closingIndex < 0) {
    throw new JournalDocumentError('Journal frontmatter is not terminated.', { code: 'unterminated-frontmatter' });
  }
  const frontmatter = markdown.slice(4, closingIndex);
  assertBound(frontmatter, COMPACT_JOURNAL_LIMITS.frontmatterBytes, 'Journal frontmatter', 'frontmatter-too-large');
  const metadata = {};
  for (const line of frontmatter.split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-z][a-z0-9_-]*):\s*(.*)$/u);
    if (!match) {
      throw new JournalDocumentError('Journal frontmatter contains invalid syntax.', {
        code: 'invalid-frontmatter-line', details: { line },
      });
    }
    const [, key, rawValue] = match;
    if (!FRONTMATTER_KEYS.includes(key)) {
      throw new JournalDocumentError(`Journal frontmatter key ${key} is not allowed.`, {
        code: 'unknown-frontmatter-key', details: { key },
      });
    }
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      throw new JournalDocumentError(`Journal frontmatter key ${key} is duplicated.`, {
        code: 'duplicate-frontmatter-key', details: { key },
      });
    }
    metadata[key] = parseFrontmatterScalar(rawValue, key);
  }
  for (const key of REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
      throw new JournalDocumentError(`Journal frontmatter is missing ${key}.`, {
        code: 'missing-frontmatter-key', details: { key },
      });
    }
  }

  const remainder = markdown.slice(closingIndex + '\n---\n'.length);
  const firstLineEnd = remainder.indexOf('\n');
  const titleLine = firstLineEnd < 0 ? remainder : remainder.slice(0, firstLineEnd);
  if (!titleLine.startsWith('# ')) {
    throw new JournalDocumentError('Journal document must contain one H1 title immediately after frontmatter.', {
      code: 'missing-title',
    });
  }
  const title = normalizeText(titleLine.slice(2));
  assertBound(title, COMPACT_JOURNAL_LIMITS.titleBytes, 'Journal title', 'title-too-large');
  const afterTitle = firstLineEnd < 0 ? '' : remainder.slice(firstLineEnd + 1);
  if (!afterTitle.startsWith('\n')) {
    throw new JournalDocumentError('Journal title and body must be separated by one blank line.', {
      code: 'missing-title-body-separator',
    });
  }
  let body = afterTitle.slice(1);
  if (body.endsWith('\n')) body = body.slice(0, -1);
  body = normalizeText(body);

  const id = validateScalar(metadata.id, 'id');
  const player = validateScalar(metadata.player, 'player');
  const created = validateTimestamp(metadata.created, 'created');
  const updated = validateTimestamp(metadata.updated, 'updated', { required: false });
  if (expectedId != null && String(expectedId) !== id) {
    throw new JournalDocumentError('Journal document ID does not match the expected index ID.', {
      code: 'id-mismatch', details: { expectedId: String(expectedId), actualId: id },
    });
  }
  const normalizedPath = path == null ? null : validateJournalPath(path, { allowStaging: true });
  const canonicalMarkdown = serializeCompactJournal({ id, player, created, updated, title, body });
  return {
    formatVersion: COMPACT_JOURNAL_FORMAT_VERSION,
    id,
    player,
    created,
    updated,
    title,
    body,
    path: normalizedPath,
    markdown: canonicalMarkdown,
    canonical: canonicalMarkdown === markdown,
  };
}

export async function hashCompactJournal(input, options = {}) {
  const parsed = typeof input === 'string' || input instanceof Uint8Array || input instanceof ArrayBuffer
    ? parseCompactJournal(input, options)
    : parseCompactJournal(serializeCompactJournal(input), options);
  return {
    ...parsed,
    contentHash: await sha256Text(parsed.markdown),
    byteLength: byteLength(parsed.markdown),
  };
}
