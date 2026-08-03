export const CHRONICLE_ENTRY_KIND = Object.freeze({
  moment: 'moment',
  entry: 'entry',
  essay: 'essay',
});

const KINDS = new Set(Object.values(CHRONICLE_ENTRY_KIND));

export function normalizeChronicleEntryKind(value) {
  return KINDS.has(value) ? value : CHRONICLE_ENTRY_KIND.entry;
}

export function validateChronicleEntryContent({
  kind = CHRONICLE_ENTRY_KIND.entry,
  title = '',
  body = '',
  images = [],
} = {}) {
  const normalizedKind = normalizeChronicleEntryKind(kind);
  const hasContent = Boolean(String(title).trim() || String(body).trim() || images.length);
  return {
    valid: hasContent && (normalizedKind !== CHRONICLE_ENTRY_KIND.essay || Boolean(String(title).trim())),
    kind: normalizedKind,
    hasContent,
    titleRequired: normalizedKind === CHRONICLE_ENTRY_KIND.essay,
  };
}

export function conservativeChronicleMetadata(journal = {}, metadata = null) {
  if (metadata) return {
    ...metadata,
    entryKind: normalizeChronicleEntryKind(metadata.entryKind),
  };
  const createdAt = journal.createdAt || new Date().toISOString();
  const legacyVisibility = journal.visibility || 'visible';
  return {
    UUID: journal.UUID,
    journalUUID: journal.UUID,
    parent: journal.parent,
    playerUUID: journal.parent,
    entryKind: CHRONICLE_ENTRY_KIND.entry,
    lifecycleState: legacyVisibility === 'draft' ? 'draft' : 'published',
    visibility: legacyVisibility === 'hidden' || legacyVisibility === 'draft'
      ? 'private'
      : 'fellows',
    occurrenceAt: createdAt,
    occurrenceIGT: journal.inGameTimestamp ?? null,
    publishedAt: legacyVisibility === 'draft' ? null : (journal.sortAt || createdAt),
    subtitle: '',
    contextSnapshot: { version: 1, private: {}, shared: {} },
    resurfacePolicy: 'normal',
    standaloneInFeed: false,
    reactionsEnabled: true,
    responsesEnabled: true,
    updatedAt: journal.editedAt || createdAt,
  };
}
