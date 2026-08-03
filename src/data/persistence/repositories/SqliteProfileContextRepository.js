import { STORES } from '../../../domain/constants.js';
import { DEFAULT_PROFILE_CONTEXT_PREFERENCES } from '../../../domain/profile-context/Contracts.js';

const CONTEXT_STORES = Object.freeze([
  STORES.profileContextItem,
  STORES.profileContextRecipient,
  STORES.profileContextSuggestion,
  STORES.profileContextPreference,
  STORES.profileContextAudit,
]);

function groupByParent(records, ownerIds) {
  const groups = new Map(ownerIds.map((id) => [String(id), []]));
  for (const record of records || []) {
    const key = String(record?.parent || '');
    if (groups.has(key)) groups.get(key).push(record);
  }
  return groups;
}

export class SqliteProfileContextRepository {
  constructor(facade) {
    if (!facade?.getAll || !facade?.add) {
      throw new Error('SqliteProfileContextRepository requires the canonical SQLite facade.');
    }
    this.facade = facade;
  }

  async getOwnerState(ownerId) {
    const owner = String(ownerId || '');
    if (!owner) return null;
    const [items, recipients, suggestions, preferences, audit] = await Promise.all(
      CONTEXT_STORES.map((store) => this.facade.getPlayerStore(store, owner)),
    );
    return {
      ownerId: owner,
      items,
      recipients,
      suggestions,
      preferences: {
        ...DEFAULT_PROFILE_CONTEXT_PREFERENCES,
        ...(preferences.find((row) => row.UUID === owner) || preferences[0] || {}),
      },
      audit,
    };
  }

  /**
   * Constant-query batch path: one canonical read per context store, regardless
   * of scene size. Callers group in memory and never issue per-profile reads.
   */
  async getBatchSnapshot(ownerIds = []) {
    const owners = [...new Set(ownerIds.map(String).filter(Boolean))];
    const [items, recipients, suggestions, preferences] = await Promise.all([
      this.facade.getAll(STORES.profileContextItem),
      this.facade.getAll(STORES.profileContextRecipient),
      this.facade.getAll(STORES.profileContextSuggestion),
      this.facade.getAll(STORES.profileContextPreference),
    ]);
    const itemGroups = groupByParent(items, owners);
    const recipientGroups = groupByParent(recipients, owners);
    const suggestionGroups = groupByParent(suggestions, owners);
    const preferenceGroups = groupByParent(preferences, owners);
    return new Map(owners.map((ownerId) => [ownerId, {
      ownerId,
      items: itemGroups.get(ownerId) || [],
      recipients: recipientGroups.get(ownerId) || [],
      suggestions: suggestionGroups.get(ownerId) || [],
      preferences: {
        ...DEFAULT_PROFILE_CONTEXT_PREFERENCES,
        ...(preferenceGroups.get(ownerId)?.find((row) => row.UUID === ownerId)
          || preferenceGroups.get(ownerId)?.[0]
          || {}),
      },
    }]));
  }

  async commit({ label = 'profile-context-command', puts = [], deletes = [] } = {}) {
    const operations = puts.map(({ store, record }) => ({ store, record }));
    if (typeof this.facade.commitAtomicMutation === 'function') {
      return this.facade.commitAtomicMutation({
        label,
        puts: operations,
        deletes,
      });
    }
    for (const operation of operations) await this.facade.add(operation.store, operation.record);
    for (const deletion of deletes) await this.facade.remove(deletion.store, deletion.UUID);
    return { committed: true };
  }
}

export default SqliteProfileContextRepository;

