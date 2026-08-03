import { STORES } from '../../../domain/constants.js';
import { deriveProfileContextFacts } from '../../../domain/profile-context/DerivationRules.js';

export class ProfileContextFactService {
  constructor(facade) {
    if (!facade?.getPlayerStore) throw new Error('ProfileContextFactService requires a database facade.');
    this.facade = facade;
  }

  async getFacts({ ownerId, viewerIGT = 0, now = new Date() } = {}) {
    const owner = String(ownerId || '');
    if (!owner) return null;
    const [tasks, todos, actionSessions, projects] = await Promise.all([
      this.facade.getPlayerStore(STORES.task, owner),
      this.facade.getPlayerStore(STORES.todo, owner),
      this.facade.getPlayerStore(STORES.actionSession, owner),
      this.facade.getPlayerStore(STORES.project, owner),
    ]);
    return deriveProfileContextFacts({ tasks, todos, actionSessions, projects, viewerIGT, now });
  }
}

export default ProfileContextFactService;

