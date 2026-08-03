import { STORES } from '../../../domain/constants.js';
import { PROFILE_CONTEXT_ACTION } from '../../../domain/profile-context/Actions.js';

function id(prefix) {
  return globalThis.crypto?.randomUUID?.()
    ? `${prefix}:${globalThis.crypto.randomUUID()}`
    : `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export class ProfileContextActionService {
  constructor(facade) {
    if (!facade?.add) throw new Error('ProfileContextActionService requires a database facade.');
    this.facade = facade;
  }

  async perform({
    action,
    viewerId,
    subjectId,
    viewerIGT = 0,
    remindAt = null,
  } = {}) {
    if (!viewerId || !subjectId || viewerId === subjectId) return { performed: false };
    const now = new Date();
    if (action === PROFILE_CONTEXT_ACTION.checkInLater) {
      const record = {
        UUID: id('profile-context-check-in'),
        parent: String(viewerId),
        title: 'Check in quietly',
        description: `Private reminder to check in with ${subjectId}.`,
        remindAt: remindAt || new Date(now.getTime() + (24 * 60 * 60 * 1000)).toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        inGameTimestamp: Math.max(0, Number(viewerIGT) || 0),
        private: true,
        source: 'profile-context',
        subjectId: String(subjectId),
      };
      await this.facade.add(STORES.reminder, record);
      return { performed: true, action, reminder: record };
    }
    return { performed: true, action, localOnly: true };
  }
}

export default ProfileContextActionService;

