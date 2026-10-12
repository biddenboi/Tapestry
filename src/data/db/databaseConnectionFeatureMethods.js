import { STORES } from '@domain/constants.js';
import { readGlobalMoney, writeGlobalMoney } from '@data/db/economyState.js';
import { normalizeAppState, compressDataUrl } from '@data/db/databaseConnectionUtils.js';
import {
  mergeProfilePlayer,
  mergeProfilePlayerLists,
} from '@data/db/profilePlayerReadModel.js';

/* ═════════════════════════════════════════════════════════════════
   PROFILE PLAYER READ MODEL
═════════════════════════════════════════════════════════════════ */

export async function getProfilePlayer(profileId) {
  if (!profileId) return null;
  const canonicalProfiles = this.persistenceRuntime?.sqliteStorageAdapter
    ?.shadowDomains?.coreProfiles;
  const [typedPlayer, documentPlayer] = await Promise.all([
    canonicalProfiles?.getPlayer?.(String(profileId)) || Promise.resolve(null),
    this.get(STORES.player, String(profileId)),
  ]);
  return mergeProfilePlayer(typedPlayer, documentPlayer);
}

export async function getAllProfilePlayers() {
  const canonicalProfiles = this.persistenceRuntime?.sqliteStorageAdapter
    ?.shadowDomains?.coreProfiles;
  const [typedPlayers, documentPlayers] = await Promise.all([
    canonicalProfiles?.listPlayers?.({
      includeArchived: true,
      includeBanned: true,
    }) || Promise.resolve([]),
    this.getAll(STORES.player),
  ]);
  return mergeProfilePlayerLists(typedPlayers, documentPlayers);
}

function reconcileAuthoritativeFriendship(connection, {
  type,
  friendship = null,
  friendshipId = null,
  reason,
}) {
  const UUID = String(friendship?.UUID || friendshipId || '');
  if (!UUID || !connection?._store) return;
  const store = connection._store(STORES.friendship);
  const previousRecord = store.get(UUID) || null;
  const operation = type === 'delete'
    ? { type: 'delete', store: STORES.friendship, UUID, previousRecord }
    : {
        type: 'put',
        store: STORES.friendship,
        record: {
          ...friendship,
          players: [...(friendship.players || [])],
        },
        previousRecord,
      };

  if (operation.type === 'delete') store.delete(UUID);
  else store.set(UUID, operation.record);

  // Typed SQLite friendship commands are authoritative and bypass the
  // document mutation path. Publish the committed row to the compatibility
  // cache and its derived consumers before returning to React.
  connection._applyProfileSummaryMutations?.([operation]);
  connection._queueMaterializedLeaderboardRebuild?.([operation], reason);
}

export async function requestSocialFriendship(command) {
  const result = await this.friendships.requestFriendship(command);
  if (result?.friendship) {
    reconcileAuthoritativeFriendship(this, {
      type: 'put',
      friendship: result.friendship,
      reason: 'social-friendship-request',
    });
  }
  return result;
}

export async function acceptSocialFriendship(command) {
  const result = await this.friendships.acceptFriendship(command);
  if (result?.friendship) {
    reconcileAuthoritativeFriendship(this, {
      type: 'put',
      friendship: result.friendship,
      reason: 'social-friendship-accept',
    });
  }
  return result;
}

export async function closeSocialFriendship(command) {
  const result = await this.friendships.closeFriendship(command);
  reconcileAuthoritativeFriendship(this, {
    type: 'delete',
    friendshipId: result?.friendshipId || command?.friendshipId,
    reason: 'social-friendship-close',
  });
  return result;
}

/* ═════════════════════════════════════════════════════════════════
   COMMENTS, FRIENDS, NOTIFICATIONS
═════════════════════════════════════════════════════════════════ */

export async function getCommentsForJournal(journalUUID) {
  const all = await this._index(STORES.journalComment, 'journalUUID', journalUUID);
  return all.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

export function getMatchesForPlayer(uuid) { return this.getPlayerStore(STORES.match, uuid); }
export function getFriendshipsForPlayer(uuid) {
  const repository = this.persistenceRuntime?.socialRepository;
  if (repository?.listFriendshipsForPlayer) {
    return repository.listFriendshipsForPlayer(uuid);
  }
  return this._index(STORES.friendship, 'players', uuid);
}

export async function getNotificationsForPlayer(playerUUID, currentPlayerIGT = Infinity) {
  const all = await this.getPlayerStore(STORES.notification, playerUUID);
  return currentPlayerIGT === Infinity ? all : all.filter((n) => (n.inGameTimestamp || 0) <= currentPlayerIGT);
}

export async function markNotificationRead(uuid) {
  const n = await this.get(STORES.notification, uuid);
  if (n) await this.add(STORES.notification, { ...n, readAt: new Date().toISOString() });
}

export async function getUnreadFriendRequestCount(playerUUID, currentPlayerIGT = Infinity) {
  const notifs = await this.getNotificationsForPlayer(playerUUID, currentPlayerIGT);
  return notifs.filter((n) => n.kind === 'friend_request' && !n.readAt).length;
}

/* ═════════════════════════════════════════════════════════════════
   EVENTS
═════════════════════════════════════════════════════════════════ */

export function getAllCustomEvents() { return this.getAll(STORES.customEvent); }
export function getAllEventLogs()    { return this.getAll(STORES.eventLog); }
export function getEventLogsForEvent(eventUUID) {
  return eventUUID ? this._index(STORES.eventLog, 'eventUUID', eventUUID) : Promise.resolve([]);
}

export function getContributionsForGoal(goalUUID) {
  return goalUUID ? this._index(STORES.contribution, 'goalUUID', goalUUID) : Promise.resolve([]);
}

export async function getContributionForTask(taskUUID) {
  if (!taskUUID) return null;
  const rows = await this._index(STORES.contribution, 'taskUUID', taskUUID);
  return rows[0] || null;
}

export async function getActiveEventBuffsForPlayer(playerUUID) {
  if (!playerUUID) return [];
  const all = await this.getPlayerStore(STORES.eventBuff, playerUUID);
  const now = Date.now();
  return all.filter((b) => {
    if (!b.expiresAt) return true;
    const exp = new Date(b.expiresAt).getTime();
    return Number.isFinite(exp) ? exp > now : true;
  });
}

export async function clearEventBuffsForPlayer(playerUUID) {
  if (!playerUUID) return;
  const all = await this.getPlayerStore(STORES.eventBuff, playerUUID);
  for (const b of all) await this.remove(STORES.eventBuff, b.UUID);
}

// Idempotent. Inserts or refreshes system events with deterministic UUIDs.
export async function seedSpecialEvents() {
  await this.ready;
  const existing = new Map((await this.getAll(STORES.customEvent)).map((e) => [e.UUID, e]));
  const now = new Date().toISOString();
  // Multiplier values are retained for competition scoring and event standings.
  const SEEDS = [
    ['special-wake-time',       'Wake Up Time',           'Combines wake-time proximity with your morning checklist. Each check carries equal weight.', 'wake_time',       25, '#38bdf8'],
    ['special-sleep-time',      'Sleep Time',             'Records bedtime proximity and your night checklist as part of the day-close history.', 'sleep_time',      25, '#a78bfa'],
    ['special-first-match',     'First Match of the Day', 'Tracks how quickly you start your first match after waking up each day.',  'first_match',     12, null],
    ['special-entertainment',   'Work Day Discipline',    'Fires when you make it through your work day without consuming entertainment items.', 'entertainment', 5, null],
  ];
  for (const [UUID, name, description, specialKind, maxBonusPct, accentColor] of SEEDS) {
    const current = existing.get(UUID);
    const next = {
      ...(current || {}),
      UUID, ownerUUID: null, name, description,
      type: 'special', specialKind, maxBonusPct,
      bannerColor: current?.bannerColor || null,
      bannerImageUrl: current?.bannerImageUrl || null,
      accentColor: current?.accentColor || accentColor || null,
      createdAt: current?.createdAt || now,
      updatedAt: current?.updatedAt || now,
    };
    const changed = !current || [
      'name', 'description', 'specialKind', 'maxBonusPct', 'accentColor',
    ].some((key) => current[key] !== next[key]);
    if (changed) await this.add(STORES.customEvent, { ...next, updatedAt: now });
  }
}

/* Store an event banner image, compressing it to IMAGE_LIMIT_KB first.
   Use this instead of calling add(STORES.customEvent, ...) directly when
   setting bannerImageUrl so compression is always enforced at write time. */
export async function saveEventBanner(eventUUID, dataUrl) {
  const e = await this.get(STORES.customEvent, eventUUID);
  if (!e) return;
  const compressed = await compressDataUrl(dataUrl);
  await this.add(STORES.customEvent, { ...e, bannerImageUrl: compressed });
}

export async function getLastEventType(types, playerUUID = null) {
  const events = playerUUID
    ? await this.getPlayerStore(STORES.event, playerUUID)
    : await this.getAll(STORES.event);
  const allowedTypes = Array.isArray(types) ? new Set(types) : null;
  return events
    .filter((event) => (allowedTypes ? allowedTypes.has(event.type) : types === event.type))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
}

/* ═════════════════════════════════════════════════════════════════
   GLOBAL MONEY (cross-profile)
═════════════════════════════════════════════════════════════════ */

export function _serializeAppState() {
  return normalizeAppState(this.appState);
}

export function getGlobalMoney() {
  return readGlobalMoney(this.economyState);
}

export function setGlobalMoney(amount) {
  const v = writeGlobalMoney(amount, this.economyState);
  this._queueAppStateWrite('economy');
  return v;
}

/* ═════════════════════════════════════════════════════════════════
   PENALTY VIOLATIONS (per-profile, per-IGT-day)

   Strikes are stored as { strikes: N, igtDay: N } so they reset
   automatically whenever the player's IGT day rolls over. The
   "ban pending" flag is a separate key that survives day rollovers
   and forces the deletion screen on every reload until wiped.
═════════════════════════════════════════════════════════════════ */

export function getViolations(playerUUID, currentIgtDay) {
  const record = this.appState.violations?.[playerUUID] || null;
  if (record?.igtDay === currentIgtDay) return { ...record };
  return { strikes: 0, igtDay: currentIgtDay };
}

export function setViolations(playerUUID, strikesOrRecord, igtDay = null) {
  if (!playerUUID) return;
  const record = typeof strikesOrRecord === 'object' && strikesOrRecord
    ? strikesOrRecord
    : { strikes: strikesOrRecord, igtDay };
  this.appState = {
    ...this.appState,
    violations: {
      ...(this.appState.violations || {}),
      [playerUUID]: {
        ...record,
        strikes: Math.max(0, Number(record.strikes) || 0),
        igtDay: Number(record.igtDay) || 0,
      },
    },
  };
  this._queueAppStateWrite();
}

export function clearViolations(playerUUID) {
  if (!playerUUID || !this.appState.violations?.[playerUUID]) return;
  const violations = { ...(this.appState.violations || {}) };
  delete violations[playerUUID];
  this.appState = { ...this.appState, violations };
  this._queueAppStateWrite();
}

export function hasBanPending(playerUUID) {
  return !!this.appState.banPending?.[playerUUID];
}

export function setBanPending(playerUUID) {
  if (!playerUUID) return;
  this.appState = {
    ...this.appState,
    banPending: {
      ...(this.appState.banPending || {}),
      [playerUUID]: true,
    },
  };
  this._queueAppStateWrite();
}

/* Call this from the deletion/ban-confirmation screen instead of wipeProfile.
   It runs the soft-ban (preserves todos) and clears the pending flag so the
   screen doesn't reappear on the next reload. */
export async function resolvePendingBan(playerUUID) {
  await this.banProfile(playerUUID);
  this.clearBanPending(playerUUID);
  await this._flushMutationWrite();
}

export function clearBanPending(playerUUID) {
  if (!playerUUID || !this.appState.banPending?.[playerUUID]) return;
  const banPending = { ...(this.appState.banPending || {}) };
  delete banPending[playerUUID];
  this.appState = { ...this.appState, banPending };
  this._queueAppStateWrite();
}

export const databaseConnectionFeatureMethods = {
  getProfilePlayer,
  getAllProfilePlayers,
  requestSocialFriendship,
  acceptSocialFriendship,
  closeSocialFriendship,
  getCommentsForJournal,
  getNotificationsForPlayer,
  markNotificationRead,
  getUnreadFriendRequestCount,
  getContributionForTask,
  getActiveEventBuffsForPlayer,
  clearEventBuffsForPlayer,
  seedSpecialEvents,
  saveEventBanner,
  getLastEventType,
  resolvePendingBan,
  getMatchesForPlayer,
  getFriendshipsForPlayer,
  getAllCustomEvents,
  getAllEventLogs,
  getEventLogsForEvent,
  getContributionsForGoal,
  _serializeAppState,
  getGlobalMoney,
  setGlobalMoney,
  getViolations,
  setViolations,
  clearViolations,
  hasBanPending,
  setBanPending,
  clearBanPending,
};
