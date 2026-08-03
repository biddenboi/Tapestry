import { STORES } from '../../../domain/constants.js';
import { validateChronicleEntryContent } from '../../../domain/chronicle/ChronicleEntryKind.js';
import { accessPreset, normalizeChronicleAccess } from '../../../domain/chronicle/ChronicleAccessPolicy.js';
import ChronicleCollaborationService from './ChronicleCollaborationService.js';

export class ChronicleDraftService {
  constructor(facade) {
    if (!facade?.add || !facade?.commitAtomicMutation) {
      throw new Error('ChronicleDraftService requires the canonical database facade.');
    }
    this.facade = facade;
    this.collaboration = new ChronicleCollaborationService(facade);
  }

  async list(playerUUID) {
    return (await this.facade.getPlayerStore(STORES.chronicleDraft, playerUUID))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  async save(draft) {
    if (!draft?.UUID || !draft?.parent) throw new Error('Chronicle drafts require identity and author.');
    const now = new Date().toISOString();
    const record = {
      entryKind: 'moment',
      title: '',
      subtitle: '',
      body: '',
      images: [],
      composerState: { version: 1 },
      visibility: 'private',
      createdAt: now,
      ...draft,
      updatedAt: now,
    };
    await this.facade.add(STORES.chronicleDraft, record);
    return record;
  }

  async publish(draft, {
    journalUUID,
    occurrenceAt = new Date().toISOString(),
    occurrenceIGT = null,
    visibility = 'private',
    existingMetadata = null,
    commandOrigin = 'desktop',
  } = {}) {
    const validation = validateChronicleEntryContent(draft);
    if (!validation.valid) throw new Error(
      validation.titleRequired ? 'Essays require a title.' : 'Add text or an image before saving.',
    );
    const now = new Date().toISOString();
    const ownerUUID = draft.ownerUUID || draft.parent;
    const journal = {
      UUID: journalUUID,
      parent: ownerUUID,
      title: String(draft.title || '').trim(),
      entry: String(draft.body || ''),
      images: draft.images || [],
      tags: [],
      createdAt: draft.createdAt || now,
      editedAt: now,
      inGameTimestamp: occurrenceIGT,
    };
    const metadata = {
      ...(existingMetadata || {}),
      UUID: journalUUID,
      journalUUID,
      parent: ownerUUID,
      playerUUID: ownerUUID,
      entryKind: validation.kind,
      lifecycleState: 'published',
      visibility,
      occurrenceAt,
      occurrenceIGT,
      publishedAt: existingMetadata?.publishedAt || now,
      subtitle: draft.subtitle || '',
      contextSnapshot: draft.contextSnapshot || { version: 1, private: {}, shared: {} },
      resurfacePolicy: draft.resurfacePolicy || 'normal',
      standaloneInFeed: Boolean(draft.standaloneInFeed),
      reactionsEnabled: draft.reactionsEnabled !== false,
      responsesEnabled: draft.responsesEnabled !== false,
      updatedAt: now,
      primaryStoryId: draft.primaryStoryId || null,
    };
    const existingAccess = await this.facade.get(STORES.chronicleEntryAccess, journalUUID);
    const desiredPreset = accessPreset(visibility);
    const access = normalizeChronicleAccess(existingAccess || {
      UUID: journalUUID,
      journalUUID,
      ownerUUID,
      visibility,
      editPolicy: desiredPreset.editPolicy,
      collaborationState: 'local',
      authorityScope: 'local',
      authorityRevision: 1,
      createdAt: journal.createdAt,
      updatedAt: now,
    }, metadata);
    const contentVisibility = existingAccess?.visibility || visibility;
    const result = await this.collaboration.saveLocalContent({
      actorUUID: draft.parent,
      journal,
      metadata: { ...metadata, visibility: contentVisibility },
      access: { ...access, visibility: contentVisibility },
      expectedRevisionNumber: existingMetadata?.currentRevisionNumber ?? null,
      clientOperationId: `entry-content:${draft.UUID}`,
      editSummary: draft.editSummary || '',
      origin: 'local',
      commandOrigin,
      deleteDraftUUID: draft.UUID,
    });
    if (existingAccess && visibility !== existingAccess.visibility) {
      const accessResult = await this.collaboration.changeAccess({
        entryUUID: journalUUID,
        actorUUID: draft.parent,
        visibility,
        clientOperationId: `entry-access:${draft.UUID}:${visibility}`,
        commandOrigin,
      });
      result.access = accessResult.access;
      result.metadata = accessResult.metadata;
    }
    return result;
  }
}

export default ChronicleDraftService;
