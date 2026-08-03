import { evaluateContextDisclosure } from '../../../domain/profile-context/DisclosurePolicy.js';
import { formatProfileContextProjection } from '../../../domain/profile-context/NarrativeFormatter.js';

export class ProfileContextProjectionService {
  constructor({ repository } = {}) {
    if (!repository) throw new Error('ProfileContextProjectionService requires a repository.');
    this.repository = repository;
    this.cache = new Map();
  }

  clearCache() {
    this.cache.clear();
  }

  async getProjection({
    viewerId,
    subjectId,
    relationshipTier = 'outside',
    viewerIGT = 0,
    revision = 0,
    now = new Date(),
  } = {}) {
    const projections = await this.getProjections({
      viewerId,
      subjects: [{ subjectId, relationshipTier }],
      viewerIGT,
      revision,
      now,
    });
    return projections.get(String(subjectId || '')) || null;
  }

  async getProjections({
    viewerId,
    subjects = [],
    viewerIGT = 0,
    revision = 0,
    now = new Date(),
  } = {}) {
    const normalized = subjects
      .map((entry) => ({
        subjectId: String(entry?.subjectId || ''),
        relationshipTier: String(entry?.relationshipTier || 'outside'),
      }))
      .filter((entry) => entry.subjectId);
    const missing = normalized.filter((entry) => !this.cache.has(
      `${viewerId}:${entry.subjectId}:${entry.relationshipTier}:${revision}:${viewerIGT}`,
    ));
    if (missing.length) {
      const snapshot = await this.repository.getBatchSnapshot(missing.map((entry) => entry.subjectId));
      for (const entry of missing) {
        const state = snapshot.get(entry.subjectId) || {
          items: [], recipients: [], preferences: {},
        };
        const recipientsByItem = new Map();
        for (const recipient of state.recipients || []) {
          const itemId = String(recipient.itemId || '');
          if (!recipientsByItem.has(itemId)) recipientsByItem.set(itemId, []);
          recipientsByItem.get(itemId).push(String(recipient.recipientId || ''));
        }
        const disclosed = state.items.flatMap((item) => {
          const recipientIds = recipientsByItem.get(String(item.UUID || '')) || [];
          const decision = evaluateContextDisclosure(item, {
            viewerId,
            subjectId: entry.subjectId,
            relationshipTier: entry.relationshipTier,
            recipientIds,
            preferences: state.preferences,
            asOf: now,
            asOfIGT: viewerIGT,
          });
          return decision.allowed ? [{ item, decision }] : [];
        });
        const projection = formatProfileContextProjection({
          viewerId,
          subjectId: entry.subjectId,
          viewerTier: String(viewerId) === entry.subjectId ? 'self' : entry.relationshipTier,
          asOfIGT: viewerIGT,
          disclosed,
        });
        const key = `${viewerId}:${entry.subjectId}:${entry.relationshipTier}:${revision}:${viewerIGT}`;
        this.cache.set(key, projection);
      }
      if (this.cache.size > 120) {
        const staleKeys = [...this.cache.keys()].slice(0, this.cache.size - 120);
        staleKeys.forEach((key) => this.cache.delete(key));
      }
    }
    return new Map(normalized.map((entry) => [
      entry.subjectId,
      this.cache.get(`${viewerId}:${entry.subjectId}:${entry.relationshipTier}:${revision}:${viewerIGT}`),
    ]));
  }
}

export default ProfileContextProjectionService;
