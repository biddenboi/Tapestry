import { STORES } from '../../../domain/constants.js';
import {
  moveStoryEntry,
  repairStoryOrdinals,
} from '../../../domain/chronicle/StoryOrdering.js';

async function commit(facade, value) {
  if (typeof facade.commitAtomicMutation === 'function') return facade.commitAtomicMutation(value);
  for (const item of value.puts || []) await facade.add(item.store, item.record);
  for (const item of value.deletes || []) await facade.remove(item.store, item.UUID);
  return { committed: true };
}

export class ChronicleStoryRepository {
  constructor(facade) {
    if (!facade?.add || !facade?.getAll) throw new Error('ChronicleStoryRepository requires a database facade.');
    this.facade = facade;
  }

  async list(playerUUID = null) {
    const stories = playerUUID
      ? await this.facade.getPlayerStore(STORES.chronicleStory, playerUUID)
      : await this.facade.getAll(STORES.chronicleStory);
    return stories.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  get(storyUUID) {
    return this.facade.get(STORES.chronicleStory, storyUUID);
  }

  async save(story) {
    if (!story?.UUID || !story?.parent || !String(story.title || '').trim()) {
      throw new Error('Stories require identity, author, and title.');
    }
    const now = new Date().toISOString();
    const record = {
      status: 'ongoing',
      visibility: 'private',
      resurfacePolicy: 'normal',
      createdAt: now,
      ...story,
      title: String(story.title).trim(),
      updatedAt: now,
    };
    await this.facade.add(STORES.chronicleStory, record);
    return record;
  }

  async memberships(storyUUID) {
    return (await this.facade.getAll(STORES.chronicleStoryEntry))
      .filter((item) => String(item.storyUUID) === String(storyUUID))
      .sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
  }

  async addEntry(storyUUID, journalUUID, { role = 'primary' } = {}) {
    const memberships = await this.memberships(storyUUID);
    const now = new Date().toISOString();
    const record = {
      UUID: `${storyUUID}:${journalUUID}`,
      parent: storyUUID,
      storyUUID,
      journalUUID,
      role,
      ordinal: memberships.length + 1,
      addedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.facade.add(STORES.chronicleStoryEntry, record);
    return record;
  }

  async reorder(storyUUID, journalUUID, direction) {
    const moved = moveStoryEntry(await this.memberships(storyUUID), journalUUID, direction)
      .map((membership) => ({ ...membership, updatedAt: new Date().toISOString() }));
    await commit(this.facade, {
      label: `chronicle-story-reorder:${storyUUID}`,
      puts: moved.map((record) => ({ store: STORES.chronicleStoryEntry, record })),
    });
    return moved;
  }

  async repair(storyUUID, entriesById = new Map()) {
    const repaired = repairStoryOrdinals(await this.memberships(storyUUID), entriesById);
    await commit(this.facade, {
      label: `chronicle-story-repair:${storyUUID}`,
      puts: repaired.map((record) => ({ store: STORES.chronicleStoryEntry, record })),
    });
    return repaired;
  }

  async remove(storyUUID) {
    const memberships = await this.memberships(storyUUID);
    await commit(this.facade, {
      label: `chronicle-story-delete:${storyUUID}`,
      deletes: [
        ...memberships.map(({ UUID }) => ({ store: STORES.chronicleStoryEntry, UUID })),
        { store: STORES.chronicleStory, UUID: storyUUID },
      ],
    });
    return true;
  }
}

export default ChronicleStoryRepository;
