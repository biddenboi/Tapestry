import { STORES } from '../../../domain/constants.js';
import {
  CONTEXT_AUDIENCE,
  CONTEXT_SOURCE,
  CONTEXT_STATUS,
  CONTEXT_SUGGESTION_STATUS,
} from '../../../domain/profile-context/Contracts.js';
import { buildContextSuggestions } from '../../../domain/profile-context/DerivationRules.js';
import { defaultContextExpiry } from '../../../domain/profile-context/Freshness.js';

function stableSuggestionId(ownerId, key) {
  const encoded = String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
  return `profile-context-suggestion:${ownerId}:${encoded}`;
}

export class ProfileContextSuggestionService {
  constructor({ repository, factService } = {}) {
    if (!repository || !factService) throw new Error('ProfileContextSuggestionService requires repository and facts.');
    this.repository = repository;
    this.factService = factService;
  }

  async refresh({ ownerId, viewerIGT = 0, now = new Date() } = {}) {
    const state = await this.repository.getOwnerState(ownerId);
    if (!state) return [];
    const facts = await this.factService.getFacts({ ownerId, viewerIGT, now });
    const existingKeys = new Set(state.suggestions
      .filter((suggestion) => suggestion.status !== CONTEXT_SUGGESTION_STATUS.expired)
      .map((suggestion) => suggestion.dedupeKey));
    const suggestions = buildContextSuggestions(facts, { existingKeys, now });
    if (suggestions.length) {
      await this.repository.commit({
        label: 'profile-context-suggestions-refresh',
        puts: suggestions.map((suggestion) => ({
          store: STORES.profileContextSuggestion,
          record: {
            UUID: stableSuggestionId(ownerId, suggestion.key),
            parent: String(ownerId),
            dedupeKey: suggestion.key,
            type: suggestion.type,
            text: suggestion.text,
            reason: suggestion.reason,
            evidence: suggestion.evidence,
            tentative: suggestion.tentative,
            source: CONTEXT_SOURCE.derived,
            audience: CONTEXT_AUDIENCE.private,
            status: CONTEXT_SUGGESTION_STATUS.pending,
            createdAt: suggestion.createdAt,
            updatedAt: suggestion.createdAt,
            expiresAt: defaultContextExpiry(suggestion.type, now),
            inGameTimestamp: Math.max(0, Number(viewerIGT) || 0),
          },
        })),
      });
    }
    const refreshed = await this.repository.getOwnerState(ownerId);
    return refreshed.suggestions
      .filter((suggestion) => suggestion.status === CONTEXT_SUGGESTION_STATUS.pending)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, 3);
  }
}

export default ProfileContextSuggestionService;

