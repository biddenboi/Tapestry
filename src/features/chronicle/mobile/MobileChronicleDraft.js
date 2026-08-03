export const MOBILE_CHRONICLE_DRAFT_SURFACE = 'mobile-quick-capture';

export function findRestorableMobileChronicleDraft(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.composerState?.surface === MOBILE_CHRONICLE_DRAFT_SURFACE)
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0]
    || null;
}

export function buildMobileChronicleDraftRecord({
  draftId,
  playerUUID,
  title = '',
  body = '',
  visibility = 'fellows',
} = {}) {
  if (!draftId || !playerUUID) return null;
  return {
    UUID: draftId,
    parent: playerUUID,
    ownerUUID: playerUUID,
    title,
    body,
    visibility,
    composerState: { version: 1, surface: MOBILE_CHRONICLE_DRAFT_SURFACE },
  };
}

