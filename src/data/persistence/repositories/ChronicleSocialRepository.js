import { STORES } from '../../../domain/constants.js';

const REACTIONS = new Set(['acknowledge', 'celebrate', 'support']);

export class ChronicleSocialRepository {
  constructor(facade) {
    if (!facade?.add || !facade?.getAll) throw new Error('ChronicleSocialRepository requires a database facade.');
    this.facade = facade;
  }

  async reactionsFor(journalUUID) {
    return (await this.facade.getAll(STORES.chronicleReaction))
      .filter((reaction) => String(reaction.journalUUID) === String(journalUUID));
  }

  async react({ journalUUID, reactorUUID, type }) {
    if (!REACTIONS.has(type)) throw new Error('Unsupported Chronicle reaction.');
    const UUID = `${journalUUID}:${reactorUUID}`;
    const existing = await this.facade.get(STORES.chronicleReaction, UUID);
    const now = new Date().toISOString();
    const record = {
      UUID,
      parent: reactorUUID,
      journalUUID,
      reactorUUID,
      type,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await this.facade.add(STORES.chronicleReaction, record);
    return record;
  }

  async clearReaction(journalUUID, reactorUUID) {
    return this.facade.remove(STORES.chronicleReaction, `${journalUUID}:${reactorUUID}`);
  }

  getFeedViewState(viewerUUID) {
    return this.facade.get(STORES.chronicleFeedViewState, viewerUUID);
  }

  async saveFeedViewState(viewerUUID, item) {
    if (!viewerUUID || !item?.publishedAt) return null;
    const record = {
      UUID: viewerUUID,
      parent: viewerUUID,
      viewerUUID,
      lastSeenPublishedAt: item.publishedAt,
      lastSeenJournalUUID: item.journalUUID || item.UUID,
      updatedAt: new Date().toISOString(),
    };
    await this.facade.add(STORES.chronicleFeedViewState, record);
    return record;
  }

  async saveStoryReadState(viewerUUID, storyUUID, journalUUID) {
    const UUID = `${viewerUUID}:${storyUUID}`;
    const record = {
      UUID,
      parent: viewerUUID,
      viewerUUID,
      storyUUID,
      lastVisibleJournalUUID: journalUUID,
      updatedAt: new Date().toISOString(),
    };
    await this.facade.add(STORES.chronicleStoryReadState, record);
    return record;
  }
}

export default ChronicleSocialRepository;
