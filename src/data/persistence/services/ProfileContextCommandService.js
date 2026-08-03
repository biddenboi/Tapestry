import { STORES } from '../../../domain/constants.js';
import {
  CONTEXT_AUDIENCE,
  CONTEXT_SOURCE,
  CONTEXT_STATUS,
  CONTEXT_SUGGESTION_STATUS,
  DEFAULT_PROFILE_CONTEXT_PREFERENCES,
  PROFILE_CONTEXT_LIMITS,
} from '../../../domain/profile-context/Contracts.js';
import { defaultContextExpiry } from '../../../domain/profile-context/Freshness.js';
import { assertValidProfileContextItem } from '../../../domain/profile-context/Validation.js';

function id(prefix = 'profile-context') {
  return globalThis.crypto?.randomUUID?.()
    ? `${prefix}:${globalThis.crypto.randomUUID()}`
    : `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function auditRecord(ownerId, actorId, action, viewerIGT, metadata = {}) {
  const now = new Date().toISOString();
  return {
    UUID: id('profile-context-audit'),
    parent: String(ownerId),
    actorId: String(actorId || ownerId),
    action,
    metadata,
    createdAt: now,
    updatedAt: now,
    inGameTimestamp: Math.max(0, Number(viewerIGT) || 0),
  };
}

export class ProfileContextCommandService {
  constructor({ repository, projectionService = null } = {}) {
    if (!repository) throw new Error('ProfileContextCommandService requires a repository.');
    this.repository = repository;
    this.projectionService = projectionService;
  }

  async saveQuickContext({
    ownerId,
    actorId = ownerId,
    chapter = '',
    showUp = '',
    decisions = [],
    audience = CONTEXT_AUDIENCE.private,
    recipientIds = [],
    expiresAt = null,
    viewerIGT = 0,
  } = {}) {
    if (!ownerId || String(ownerId) !== String(actorId)) {
      const error = new Error('Only the profile owner can author context.');
      error.code = 'profile-context-owner-required';
      throw error;
    }
    const state = await this.repository.getOwnerState(ownerId);
    const now = new Date();
    const createdAt = now.toISOString();
    const inputs = [
      ...(String(chapter).trim() ? [{ type: 'chapter', text: chapter }] : []),
      ...decisions.slice(0, PROFILE_CONTEXT_LIMITS.primaryDecisions)
        .filter((entry) => String(entry?.text || '').trim())
        .map((entry) => ({ type: entry.type || 'now', text: entry.text, tentative: entry.tentative })),
      ...(String(showUp).trim() ? [{ type: 'show-up', text: showUp }] : []),
    ];
    const records = inputs.map((entry) => assertValidProfileContextItem({
      UUID: id('profile-context-item'),
      parent: String(ownerId),
      ...entry,
      source: CONTEXT_SOURCE.manual,
      audience,
      recipientIds,
      sourceVisibility: audience,
      sensitivity: audience === CONTEXT_AUDIENCE.private ? 'private' : 'low',
      status: CONTEXT_STATUS.active,
      quick: true,
      createdAt,
      updatedAt: createdAt,
      expiresAt: expiresAt || defaultContextExpiry(entry.type, now),
      inGameTimestamp: Math.max(0, Number(viewerIGT) || 0),
    }));
    const priorQuick = state.items.filter((item) => item.quick && item.status === CONTEXT_STATUS.active);
    const recipients = records.flatMap((record) => (record.recipientIds || []).map((recipientId) => ({
      UUID: `${record.UUID}:${recipientId}`,
      parent: String(ownerId),
      itemId: record.UUID,
      recipientId,
      createdAt,
      updatedAt: createdAt,
      inGameTimestamp: Math.max(0, Number(viewerIGT) || 0),
    })));
    await this.repository.commit({
      label: 'profile-context-quick-save',
      puts: [
        ...priorQuick.map((item) => ({
          store: STORES.profileContextItem,
          record: { ...item, status: CONTEXT_STATUS.revoked, updatedAt: createdAt },
        })),
        ...records.map((record) => ({ store: STORES.profileContextItem, record })),
        ...recipients.map((record) => ({ store: STORES.profileContextRecipient, record })),
        {
          store: STORES.profileContextAudit,
          record: auditRecord(ownerId, actorId, 'quick-context-saved', viewerIGT, {
            audience,
            itemCount: records.length,
          }),
        },
      ],
    });
    this.projectionService?.clearCache();
    return records;
  }

  async saveItem({ ownerId, actorId = ownerId, item, viewerIGT = 0 } = {}) {
    if (!ownerId || String(ownerId) !== String(actorId)) throw new Error('Only the profile owner can author context.');
    const now = new Date();
    const record = assertValidProfileContextItem({
      ...item,
      UUID: item?.UUID || id('profile-context-item'),
      parent: String(ownerId),
      status: item?.status || CONTEXT_STATUS.active,
      source: item?.source || CONTEXT_SOURCE.manual,
      createdAt: item?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: item?.expiresAt || defaultContextExpiry(item?.type, now),
      inGameTimestamp: item?.inGameTimestamp ?? Math.max(0, Number(viewerIGT) || 0),
    });
    const recipientPuts = (record.recipientIds || []).map((recipientId) => ({
      store: STORES.profileContextRecipient,
      record: {
        UUID: `${record.UUID}:${recipientId}`,
        parent: String(ownerId),
        itemId: record.UUID,
        recipientId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        inGameTimestamp: Math.max(0, Number(viewerIGT) || 0),
      },
    }));
    await this.repository.commit({
      label: 'profile-context-item-save',
      puts: [
        { store: STORES.profileContextItem, record },
        ...recipientPuts,
        {
          store: STORES.profileContextAudit,
          record: auditRecord(ownerId, actorId, 'item-saved', viewerIGT, { itemId: record.UUID }),
        },
      ],
    });
    this.projectionService?.clearCache();
    return record;
  }

  async revokeItem({ ownerId, actorId = ownerId, itemId, viewerIGT = 0 } = {}) {
    if (!ownerId || String(ownerId) !== String(actorId)) throw new Error('Only the profile owner can revoke context.');
    const state = await this.repository.getOwnerState(ownerId);
    const item = state.items.find((entry) => entry.UUID === itemId);
    if (!item) return false;
    const now = new Date().toISOString();
    await this.repository.commit({
      label: 'profile-context-item-revoke',
      puts: [
        {
          store: STORES.profileContextItem,
          record: { ...item, status: CONTEXT_STATUS.revoked, updatedAt: now },
        },
        {
          store: STORES.profileContextAudit,
          record: auditRecord(ownerId, actorId, 'item-revoked', viewerIGT, { itemId }),
        },
      ],
    });
    this.projectionService?.clearCache();
    return true;
  }

  async resolveSuggestion({
    ownerId,
    actorId = ownerId,
    suggestionId,
    resolution,
    editedText = null,
    audience = CONTEXT_AUDIENCE.private,
    viewerIGT = 0,
  } = {}) {
    if (!ownerId || String(ownerId) !== String(actorId)) throw new Error('Only the profile owner can resolve suggestions.');
    const state = await this.repository.getOwnerState(ownerId);
    const suggestion = state.suggestions.find((entry) => entry.UUID === suggestionId);
    if (!suggestion || suggestion.status !== CONTEXT_SUGGESTION_STATUS.pending) return null;
    const now = new Date().toISOString();
    const accepted = resolution === 'accept';
    const resolvedSuggestion = {
      ...suggestion,
      status: accepted ? CONTEXT_SUGGESTION_STATUS.accepted : CONTEXT_SUGGESTION_STATUS.dismissed,
      resolvedAt: now,
      updatedAt: now,
    };
    const item = accepted ? assertValidProfileContextItem({
      UUID: id('profile-context-item'),
      parent: String(ownerId),
      type: suggestion.type,
      text: editedText || suggestion.text,
      source: CONTEXT_SOURCE.derived,
      sourceType: 'suggestion',
      sourceId: suggestion.UUID,
      sourceVisibility: audience,
      evidence: suggestion.evidence || [],
      tentative: suggestion.tentative === true,
      audience,
      sensitivity: 'low',
      status: CONTEXT_STATUS.active,
      createdAt: now,
      updatedAt: now,
      expiresAt: suggestion.expiresAt || defaultContextExpiry(suggestion.type, now),
      inGameTimestamp: Math.max(0, Number(viewerIGT) || 0),
    }) : null;
    await this.repository.commit({
      label: 'profile-context-suggestion-resolve',
      puts: [
        { store: STORES.profileContextSuggestion, record: resolvedSuggestion },
        ...(item ? [{ store: STORES.profileContextItem, record: item }] : []),
        {
          store: STORES.profileContextAudit,
          record: auditRecord(ownerId, actorId, accepted ? 'suggestion-accepted' : 'suggestion-dismissed', viewerIGT, {
            suggestionId,
            itemId: item?.UUID || null,
          }),
        },
      ],
    });
    this.projectionService?.clearCache();
    return { suggestion: resolvedSuggestion, item };
  }

  async savePreferences({ ownerId, actorId = ownerId, preferences, viewerIGT = 0 } = {}) {
    if (!ownerId || String(ownerId) !== String(actorId)) throw new Error('Only the profile owner can change context preferences.');
    const now = new Date().toISOString();
    const record = {
      UUID: String(ownerId),
      parent: String(ownerId),
      ...DEFAULT_PROFILE_CONTEXT_PREFERENCES,
      ...(preferences || {}),
      updatedAt: now,
      createdAt: preferences?.createdAt || now,
      inGameTimestamp: Math.max(0, Number(viewerIGT) || 0),
    };
    await this.repository.commit({
      label: 'profile-context-preferences-save',
      puts: [
        { store: STORES.profileContextPreference, record },
        {
          store: STORES.profileContextAudit,
          record: auditRecord(ownerId, actorId, 'preferences-saved', viewerIGT),
        },
      ],
    });
    this.projectionService?.clearCache();
    return record;
  }
}

export default ProfileContextCommandService;

