import { STORES } from '../../../domain/constants.js';

export class NextMoveFeedbackRepository {
  constructor(facade) {
    if (!facade?.getPlayerStore || !facade?.add) {
      throw new Error('NextMoveFeedbackRepository requires the canonical database facade.');
    }
    this.facade = facade;
  }

  list(playerUUID) {
    return this.facade.getPlayerStore(STORES.nextMoveFeedback, String(playerUUID));
  }

  save(feedback) {
    return this.facade.add(STORES.nextMoveFeedback, feedback).then(() => feedback);
  }
}

export default NextMoveFeedbackRepository;
