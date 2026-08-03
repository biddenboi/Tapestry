import { STORES } from '../../../domain/constants.js';

export class NextMoveDecisionRepository {
  constructor(facade) {
    if (!facade?.getPlayerStore || !facade?.add) {
      throw new Error('NextMoveDecisionRepository requires the canonical database facade.');
    }
    this.facade = facade;
  }

  async list(playerUUID) {
    return (await this.facade.getPlayerStore(STORES.nextMoveDecision, String(playerUUID)))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  async latest(playerUUID) {
    return (await this.list(playerUUID))[0] || null;
  }

  save(decision) {
    return this.facade.add(STORES.nextMoveDecision, decision).then(() => decision);
  }
}

export default NextMoveDecisionRepository;
