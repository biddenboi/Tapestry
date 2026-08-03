import { STORES } from '@domain/constants.js';
import { withPlayerMatchResult } from '@domain/matches/IGT.js';
import { isRecordVisibleThroughIGT } from '@data/db/recordVisibility.js';
import { cloneValue, matchesIndex } from '@data/db/databaseConnectionUtils.js';
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

export class TimelineQueryService {
  constructor(facade) { if (!facade) throw new Error('TimelineQueryService requires a database facade.'); this.facade = facade; return facadeBackedService(this, facade); }

  async getAllThroughIGT(store, viewerIGT = Infinity) {
    const limit = Number(viewerIGT);
    if (!Number.isFinite(limit)) return this.getAll(store);
    await this.ready;
    return this._recordValues(store)
      .filter((record) => isRecordVisibleThroughIGT(store, record, limit))
      .map(cloneValue);
  }

  async getPlayerStoreThroughIGT(store, playerUUID, viewerIGT = Infinity) {
    const limit = Number(viewerIGT);
    if (!Number.isFinite(limit)) return this.getPlayerStore(store, playerUUID);
    await this.ready;
    return this._recordValues(store)
      .filter((record) => matchesIndex(record, 'parent', playerUUID))
      .filter((record) => isRecordVisibleThroughIGT(store, record, limit))
      .map(cloneValue);
  }

  async getRandomVisibleFeedEntry(viewerIGT, { filters = {}, random = Math.random } = {}) {
    await this.ready;
    if (this.bootPartial && !this.loadedDomains.has('journals')) {
      await this.ensureDomainLoaded('journals');
    }
    const journals = this._store(STORES.journal);
    const selected = this._ensureFeedRandomIndex(journals).select(journals, {
      viewerIGT,
      filters,
      random,
    });
    return selected ? cloneValue(selected) : null;
  }

  async getCommentsForJournalThroughIGT(journalUUID, viewerIGT = Infinity) {
    const limit = Number(viewerIGT);
    if (!Number.isFinite(limit)) return this.getCommentsForJournal(journalUUID);
    const boundary = Math.max(0, limit);
    await this.ready;
    return this._recordValues(STORES.journalComment)
      .filter((comment) => matchesIndex(comment, 'journalUUID', journalUUID))
      .filter((comment) => Number(comment?.inGameTimestamp || 0) <= boundary)
      .sort((a, b) => Number(a.inGameTimestamp || 0) - Number(b.inGameTimestamp || 0))
      .map(cloneValue);
  }

  async getEventLogsForEventThroughIGT(eventUUID, viewerIGT = Infinity) {
    const limit = Number(viewerIGT);
    if (!Number.isFinite(limit)) return this.getEventLogsForEvent(eventUUID);
    const boundary = Math.max(0, limit);
    await this.ready;
    return this._recordValues(STORES.eventLog)
      .filter((eventLog) => matchesIndex(eventLog, 'eventUUID', eventUUID))
      .filter((eventLog) => Number(eventLog?.inGameTimestamp || 0) <= boundary)
      .map(cloneValue);
  }

  async getCompletedMatchesThroughIGT(viewerIGT = Infinity) {
    const limit = Number(viewerIGT);
    await this.ready;
    const matches = this._recordValues(STORES.match);
    const visibleMatches = Number.isFinite(limit)
      ? matches.filter((match) => isRecordVisibleThroughIGT(STORES.match, match, Math.max(0, limit)))
      : matches;
    return visibleMatches
      .filter((match) => match.status === 'complete')
      .map(cloneValue);
  }

  async getProfileMatchesForPlayer(playerUUID, viewerIGT = Infinity) {
    await this.ready;
    const boundary = Number(viewerIGT);
    return this._recordValues(STORES.match)
      .filter((match) => match?.status === 'complete')
      .filter((match) => !Number.isFinite(boundary)
        || isRecordVisibleThroughIGT(STORES.match, match, Math.max(0, boundary)))
      .filter((match) => (
        (match.participantUUIDs || match.participants || []).includes(playerUUID)
        || (match.participantSnapshot || []).some((participant) => participant?.UUID === playerUUID)
        || match.playerUUID === playerUUID
      ))
      .map((match) => withPlayerMatchResult(match, playerUUID));
  }

  async getVisibleMatchesForPlayer(playerUUID, viewerIGT = Infinity) {
    const { matches } = await this.getEloWorldAtIGT(viewerIGT);
    return matches
      .filter((match) => (match.participantUUIDs || []).some((participantUUID) => (
        String(participantUUID) === String(playerUUID)
      )))
      .map((match) => withPlayerMatchResult(match, playerUUID));
  }

}
export default TimelineQueryService;
