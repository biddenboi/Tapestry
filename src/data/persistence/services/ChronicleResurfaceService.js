import { STORES } from '../../../domain/constants.js';
import {
  isChronicleResurfaceEligible,
  onThisDayCandidates,
} from '../../../domain/chronicle/ChronicleResurfacePolicy.js';
import ChronicleQueryService from './ChronicleQueryService.js';

export class ChronicleResurfaceService {
  constructor(facade) {
    if (!facade?.getAll) throw new Error('ChronicleResurfaceService requires a database facade.');
    this.facade = facade;
    this.query = new ChronicleQueryService(facade);
  }

  async revisit({ playerUUID, viewerIGT = Infinity, now = new Date(), limit = 4 } = {}) {
    const [{ entries }, states] = await Promise.all([
      this.query.chronicleForProfile({
        profileUUID: playerUUID,
        viewerUUID: playerUUID,
        viewerIGT,
      }),
      this.facade.getPlayerStore(STORES.chronicleResurfaceState, playerUUID),
    ]);
    const stateBySubject = new Map(states.map((state) => [String(state.subjectId), state]));
    const eligible = entries.map((entry) => ({
      ...entry,
      ...(stateBySubject.get(String(entry.UUID)) || {}),
    })).filter((entry) => isChronicleResurfaceEligible(entry, { now }));
    const onThisDay = onThisDayCandidates(eligible, now);
    return (onThisDay.length ? onThisDay : eligible)
      .slice(0, Math.max(1, Math.min(12, limit)));
  }

  async suppress(viewerUUID, subjectType, subjectId) {
    const UUID = `${viewerUUID}:${subjectType}:${subjectId}`;
    const now = new Date().toISOString();
    const record = {
      UUID,
      parent: viewerUUID,
      viewerUUID,
      subjectType,
      subjectId,
      dismissedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.facade.add(STORES.chronicleResurfaceState, record);
    return record;
  }
}

export default ChronicleResurfaceService;
