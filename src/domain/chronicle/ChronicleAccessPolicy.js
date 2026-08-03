export const CHRONICLE_ACCESS_PRESET = Object.freeze({
  private: Object.freeze({ visibility: 'private', editPolicy: 'owner' }),
  fellows: Object.freeze({ visibility: 'fellows', editPolicy: 'owner' }),
  global: Object.freeze({ visibility: 'global', editPolicy: 'any_profile' }),
});

export const CHRONICLE_COLLABORATION_STATE = Object.freeze({
  local: 'local',
  active: 'active',
  locked: 'locked',
  unavailable: 'unavailable',
  moderated: 'moderated',
});

export function accessPreset(value = 'private') {
  const preset = CHRONICLE_ACCESS_PRESET[String(value || '').toLowerCase()];
  if (!preset) throw new Error(`Unsupported Entry sharing preset: ${value}`);
  return preset;
}

export function normalizeChronicleAccess(access = {}, metadata = {}) {
  const visibility = access.visibility || metadata.visibility || 'private';
  const preset = accessPreset(visibility);
  const ownerUUID = access.ownerUUID
    || metadata.ownerUUID
    || metadata.playerUUID
    || metadata.parent
    || null;
  const storedEditPolicy = access.editPolicy || preset.editPolicy;
  const editPolicy = visibility === 'global' && storedEditPolicy === 'any_authenticated'
    ? 'any_profile'
    : storedEditPolicy;
  const storedCollaborationState = access.collaborationState;
  const collaborationState = visibility === 'global' && storedCollaborationState === 'unavailable'
    ? 'local'
    : storedCollaborationState || 'local';
  return {
    UUID: access.UUID || access.journalUUID || metadata.UUID || metadata.journalUUID,
    journalUUID: access.journalUUID || access.UUID || metadata.journalUUID || metadata.UUID,
    ownerUUID,
    parent: ownerUUID,
    visibility,
    editPolicy,
    collaborationState,
    authorityRevision: Math.max(1, Number(access.authorityRevision) || 1),
    authorityScope: 'local',
    lockedAt: access.lockedAt || null,
    lockedBy: access.lockedBy || null,
    createdAt: access.createdAt || metadata.createdAt || metadata.occurrenceAt || null,
    updatedAt: access.updatedAt || metadata.updatedAt || null,
  };
}

export function canViewEntry(access, {
  viewerUUID = null,
  lifecycleState = 'published',
  occurrenceIGT = null,
  viewerIGT = Infinity,
} = {}) {
  const normalized = normalizeChronicleAccess(access, access);
  const owner = Boolean(viewerUUID)
    && String(viewerUUID) === String(normalized.ownerUUID || '');
  if (owner) return lifecycleState !== 'draft' || owner;
  if (!viewerUUID || lifecycleState !== 'published') return false;
  if (
    Number.isFinite(Number(viewerIGT))
    && occurrenceIGT != null
    && Number(occurrenceIGT) > Number(viewerIGT)
  ) return false;
  if (normalized.collaborationState === 'moderated') return false;
  return normalized.visibility === 'fellows' || normalized.visibility === 'global';
}

export function canEditEntry(access, { actorUUID = null } = {}) {
  if (!actorUUID) return false;
  const normalized = normalizeChronicleAccess(access, access);
  if (String(actorUUID) === String(normalized.ownerUUID || '')) return true;
  return normalized.visibility === 'global'
    && normalized.editPolicy === 'any_profile'
    && (normalized.collaborationState === 'local' || normalized.collaborationState === 'active');
}

export function canControlEntry(access, actorUUID) {
  const normalized = normalizeChronicleAccess(access, access);
  return Boolean(actorUUID) && String(actorUUID) === String(normalized.ownerUUID || '');
}

export function assertSupportedAccessCombination({ visibility, editPolicy }) {
  const preset = accessPreset(visibility);
  if (preset.editPolicy !== editPolicy) {
    throw new Error(`Unsupported Entry access combination: ${visibility}/${editPolicy}`);
  }
  return true;
}
