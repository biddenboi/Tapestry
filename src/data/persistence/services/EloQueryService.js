import { STORES } from '@domain/constants.js';
import { replayEloTimeline } from '@domain/matches/IGT.js';
import { cloneValue } from '@data/db/databaseConnectionUtils.js';
function facadeBackedService(target, facade) {
  return new Proxy(target, {
    get(service, property, receiver) {
      if (Reflect.has(service, property)) return Reflect.get(service, property, receiver);
      const value = Reflect.get(facade, property, facade);
      return typeof value === 'function' ? value.bind(facade) : value;
    },
    set(service, property, value, receiver) {
      if (Reflect.has(service, property)) return Reflect.set(service, property, value, receiver);
      return Reflect.set(facade, property, value, facade);
    },
  });
}

export class EloQueryService {
  constructor(facade) { if (!facade) throw new Error('EloQueryService requires a database facade.'); this.facade = facade; return facadeBackedService(this, facade); }

  async getEloWorldAtIGT(viewerIGT, options) {
    const numericIGT = Number(viewerIGT);
    const boundary = Number.isFinite(numericIGT) ? Math.max(0, numericIGT) : Infinity;
    const cacheBoundary = Number.isFinite(boundary)
      ? Math.trunc(boundary)
      : boundary;
    const cacheKey = `${cacheBoundary}:${options?.includeArchived !== false}:${options?.includeBanned === true}`;
    if (!this.eloWorldCache.has(cacheKey)) {
      const projection = Promise.all([
        this.getAllPlayers(options),
        this.getCompletedMatchesThroughIGT(boundary),
      ]).then(([players, matches]) => replayEloTimeline(players, matches));
      this.eloWorldCache.set(cacheKey, projection);
      projection.catch(() => this.eloWorldCache.delete(cacheKey));

      while (this.eloWorldCache.size > 12) {
        this.eloWorldCache.delete(this.eloWorldCache.keys().next().value);
      }
    }
    return this.eloWorldCache.get(cacheKey);
  }

  async getPlayersAtIGT(viewerIGT, options) {
    return (await this.getEloWorldAtIGT(viewerIGT, options)).players;
  }

  async getPlayerAtIGT(playerUUID, viewerIGT) {
    const players = await this.getPlayersAtIGT(viewerIGT);
    return players.find((player) => String(player.UUID) === String(playerUUID)) || null;
  }

  async getStoreFromRange(store, startDate, endDate) {
    await this.ready;
    const start = String(startDate || '');
    const end = String(endDate || '');
    return this._recordValues(store)
      .filter((record) => {
        const value = store === STORES.task && record?.completedAt
          ? record.completedAt
          : record?.createdAt;
        return value >= start && value <= end;
      })
      .map(cloneValue);
  }
}
export default EloQueryService;
