import {
  CHRONICLE_ACCESS_PRESET,
  canViewEntry,
  normalizeChronicleAccess,
} from './ChronicleAccessPolicy.js';

export const CHRONICLE_VISIBILITY = Object.freeze({
  private: CHRONICLE_ACCESS_PRESET.private.visibility,
  fellows: CHRONICLE_ACCESS_PRESET.fellows.visibility,
  global: CHRONICLE_ACCESS_PRESET.global.visibility,
});

export function canViewChronicleEntry(metadata, {
  viewerUUID = null,
  authorUUID = metadata?.playerUUID || metadata?.parent || null,
  viewerIGT = Infinity,
} = {}) {
  if (!metadata) return false;
  return canViewEntry(normalizeChronicleAccess(metadata.access || metadata, {
    ...metadata,
    ownerUUID: authorUUID,
  }), {
    viewerUUID,
    lifecycleState: metadata.lifecycleState,
    occurrenceIGT: metadata.occurrenceIGT,
    viewerIGT,
  });
}

export function publicChronicleMetadata(metadata = {}, viewerUUID = null) {
  const owner = String(viewerUUID || '') === String(metadata.playerUUID || metadata.parent || '');
  const snapshot = metadata.contextSnapshot || { version: 1, private: {}, shared: {} };
  return {
    ...metadata,
    contextSnapshot: owner
      ? snapshot
      : { version: snapshot.version || 1, shared: snapshot.shared || {} },
  };
}
