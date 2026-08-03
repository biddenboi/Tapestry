import { STORES } from '../../../domain/constants.js';
import { buildDaybookPage } from '../../../domain/profile/ProfileDaybook.js';
import { getRankLabel } from '../../../domain/rank/Rank.js';

function facadeBackedService(target, facade) {
  return new Proxy(target, {
    get(service, property, receiver) {
      if (Reflect.has(service, property)) return Reflect.get(service, property, receiver);
      const value = Reflect.get(facade, property, facade);
      return typeof value === 'function' ? value.bind(facade) : value;
    },
  });
}

export class ProfileDaybookQueryService {
  constructor(facade) {
    if (!facade) throw new Error('ProfileDaybookQueryService requires a database facade.');
    this.facade = facade;
    return facadeBackedService(this, facade);
  }

  async getProfileDaybookPage({
    profileId,
    viewerIGT,
    beforeDay = null,
    afterDay = null,
    dayLimit = 5,
    type = 'all',
    search = '',
    pinnedOnly = false,
    sort = 'newest',
  } = {}) {
    if (!profileId) return buildDaybookPage([], viewerIGT, { dayLimit });
    await this.ready;

    const completionByTask = new Map(
      this._recordValues(STORES.taskCompletionEvent)
        .filter((event) => sameId(event?.parent, profileId) && event?.taskUUID)
        .map((event) => [String(event.taskUUID), event]),
    );
    const projectsById = new Map(
      this._recordValues(STORES.project)
        .filter((project) => sameId(project?.parent, profileId))
        .map((project) => [String(project.UUID), project]),
    );
    const tasks = this._recordValues(STORES.task)
      .filter((task) => sameId(task?.parent, profileId) && task?.completedAt)
      .map((task) => {
        const completion = completionByTask.get(String(task.UUID));
        const project = task.projectId ? projectsById.get(String(task.projectId)) : null;
        return {
          ...cloneRecord(task),
          type: 'task',
          sortAt: task.completedAt || task.createdAt || null,
          inGameTimestamp: completedIGT(task),
          durationMs: finiteDuration(
            completion?.durationMs ?? task.actualDurationMs ?? task.actual_duration_ms,
          ),
          projectName: project?.name || task.projectName || null,
          projectState: project?.completedAt ? 'completed' : project?.status || null,
        };
      });
    const journals = this._recordValues(STORES.journal)
      .filter((journal) => sameId(journal?.parent, profileId))
      .map((journal) => ({
        ...cloneRecord(journal),
        type: 'journal',
        sortAt: journal.createdAt || null,
      }));
    const events = this._recordValues(STORES.event)
      .filter((event) => sameId(event?.parent, profileId))
      .map((event) => ({
        ...cloneRecord(event),
        originalType: event.type,
        type: event.type === 'item_use' ? 'item_use' : 'event',
        sortAt: event.createdAt || null,
      }));
    const transactions = this._recordValues(STORES.transaction)
      .filter((transaction) => sameId(transaction?.parent, profileId))
      .map((transaction) => ({
        ...cloneRecord(transaction),
        originalType: transaction.type,
        type: transaction.type === 'money_log' ? 'money_log' : 'transaction',
        sortAt: transaction.completedAt || transaction.createdAt || null,
      }));
    const sourceMatches = this._daybookMatches(profileId);
    const matches = sourceMatches.map((match) => ({
      ...cloneRecord(match),
      type: 'match',
      name: match.name || 'Match completed',
      sortAt: match.result?.concludedAt || match.completedAt || match.createdAt || null,
      inGameTimestamp: completedIGT(match),
    }));
    const rankChanges = sourceMatches
      .map((match) => rankChangeEntry(match, profileId))
      .filter(Boolean);
    const entries = dedupeEntries([
      ...tasks,
      ...journals,
      ...events,
      ...transactions,
      ...matches,
      ...rankChanges,
    ]);

    return buildDaybookPage(entries, viewerIGT, {
      beforeDay,
      afterDay,
      dayLimit,
      type,
      search,
      pinnedOnly,
      sort,
    });
  }

  _daybookMatches(profileId) {
    const summary = this._recordValues(STORES.profileSummary)
      .find((record) => sameId(record?.UUID, profileId));
    const summaryMatches = summary?.recentMatches || summary?.profileView?.matchSummary?.recent || [];
    const loadedMatches = this.loadedDomains?.has?.('matches')
      ? this._recordValues(STORES.match)
      : [];
    return dedupeEntries([...loadedMatches, ...summaryMatches])
      .filter((match) => match?.status !== 'active' && matchIncludesPlayer(match, profileId));
  }
}

function rankChangeEntry(match, profileId) {
  const result = match?.result || {};
  const playerChange = result.playerEloChanges?.[String(profileId)] || null;
  const isOwner = sameId(match?.parent, profileId) || sameId(match?.playerUUID, profileId);
  const delta = Number(playerChange?.change ?? (isOwner ? result.eloChange : NaN));
  if (!Number.isFinite(delta) || delta === 0) return null;
  const oldElo = Number(playerChange?.oldElo ?? (isOwner ? result.oldElo : NaN));
  const newElo = Number(playerChange?.newElo ?? (isOwner ? result.newElo : NaN));
  const hasRange = Number.isFinite(oldElo) && Number.isFinite(newElo);
  const signed = `${delta > 0 ? '+' : ''}${Math.round(delta)} ELO`;
  return {
    UUID: `rank:${match.UUID || match.id}:${profileId}`,
    type: 'rank',
    name: `Rank changed · ${signed}`,
    description: hasRange
      ? `${getRankLabel(oldElo)} → ${getRankLabel(newElo)}`
      : 'Competitive rating updated',
    rankDelta: delta,
    oldElo: hasRange ? oldElo : null,
    newElo: hasRange ? newElo : null,
    matchUUID: match.UUID || match.id || null,
    inGameTimestamp: completedIGT(match),
    sortAt: result.concludedAt || match.completedAt || match.createdAt || null,
  };
}

function completedRecordIGT(record) {
  for (const value of [record?.completedInGameTimestamp, record?.result?.inGameTimestamp]) {
    if (value == null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  const started = Number(record?.inGameTimestamp);
  if (Number.isFinite(started)) return Math.max(0, started);
  for (const value of [record?.completedInGameTimestamp, record?.result?.inGameTimestamp]) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.max(0, numeric);
  }
  return 0;
}

function completedIGT(record) {
  return completedRecordIGT(record);
}

function matchIncludesPlayer(match, profileId) {
  if (sameId(match?.parent, profileId) || sameId(match?.playerUUID, profileId)) return true;
  const ids = [
    ...(Array.isArray(match?.participants) ? match.participants : []),
    ...(Array.isArray(match?.participantUUIDs) ? match.participantUUIDs : []),
    ...(Array.isArray(match?.participantSnapshot) ? match.participantSnapshot : []),
    ...(Array.isArray(match?.participantSnapshot?.participants)
      ? match.participantSnapshot.participants
      : []),
    ...(Array.isArray(match?.teams) ? match.teams.flat(Infinity) : []),
  ].map((participant) => participant?.UUID ?? participant);
  return ids.some((id) => sameId(id, profileId));
}

function dedupeEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (!entry) return false;
    const key = `${entry.type || 'record'}:${entry.UUID || entry.id || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cloneRecord(value) {
  if (!value || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function finiteDuration(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

export default ProfileDaybookQueryService;
