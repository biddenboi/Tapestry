import { STORES } from '@domain/constants.js';
import {
  activatePlayerIGT,
  freezePlayerIGT,
  getCurrentIGT,
  getLocalDate,
} from '@domain/time/Time.js';
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

function matchReferencesProfile(match, playerUUID) {
  const target = String(playerUUID || '');
  if (!target) return false;
  if ([match?.parent, match?.playerUUID].some((value) => String(value || '') === target)) {
    return true;
  }
  const participantValues = [
    ...(Array.isArray(match?.participantUUIDs) ? match.participantUUIDs : []),
    ...(Array.isArray(match?.participants) ? match.participants : []),
    ...(Array.isArray(match?.participantSnapshot) ? match.participantSnapshot : []),
    ...(Array.isArray(match?.participantSnapshot?.participants)
      ? match.participantSnapshot.participants
      : []),
    ...(Array.isArray(match?.teams) ? match.teams.flat() : []),
  ];
  return participantValues.some((participant) => String(
    participant?.UUID || participant?.playerUUID || participant || '',
  ) === target);
}

export class ProfileLifecycleService {
  constructor(facade) { if (!facade) throw new Error('ProfileLifecycleService requires a database facade.'); this.facade = facade; return facadeBackedService(this, facade); }

  _isBanned(p) { return !!p?.bannedAt; }

  getActivePlayerUUID() { return this.appState.activePlayerUUID || null; }

  getActivePlayerChangedAt() { return this.appState.activePlayerChangedAt || null; }

  setActivePlayerUUID(uuid, { changedAt = new Date().toISOString() } = {}) {
    this.appState = {
      ...this.appState,
      activePlayerUUID: uuid || null,
      activePlayerChangedAt: changedAt || new Date().toISOString(),
    };
    this._queueAppStateWrite();
  }

  async _getCurrentPlayerRecord() {
    await this.ready;
    const active = this.getActivePlayerUUID();
    if (active) {
      const p = await this.get(STORES.player, active);
      if (p && !this._isBanned(p)) return p;
    }
    // Fall back to the most-recently-created non-banned player.
    const fallback = (await this.getAll(STORES.player))
      .filter((player) => !this._isBanned(player))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
    if (fallback?.UUID) {
      const activated = activatePlayerIGT(fallback);
      await this.commitAtomicMutation({
        label: 'activate-fallback-profile',
        puts: [{ store: STORES.player, record: activated }],
        flush: false,
      });
      await this._synchronizePlayerIGTClockRows(
        [activated],
        'activate-fallback-profile-projection',
      );
      this.setActivePlayerUUID(fallback.UUID);
      await this._flushMutationWrite();
      return activated;
    }
    return fallback;
  }

  async getCurrentPlayer() {
    const stored = await this._getCurrentPlayerRecord();
    if (!stored) return null;
    return this.getPlayerAtIGT(stored.UUID, getCurrentIGT(stored))
      .then((projected) => {
        if (!projected) return stored;
        // The ELO projection can legitimately outlive a profile write that
        // lands in the same minute. Keep its historical rating, but never let
        // that cached projection roll back current profile fields such as the
        // selected theme, identity, policies, or wallet state.
        return {
          ...projected,
          ...stored,
          elo: projected.elo,
          hasVisibleRating: projected.hasVisibleRating === true,
        };
      });
  }

  async getAllPlayers({ includeArchived = true, includeBanned = false } = {}) {
    const all = await this.getAll(STORES.player);
    return all
      .filter((p) => includeArchived || !p.archivedAt)
      .filter((p) => includeBanned  || !this._isBanned(p))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  getActivePlayers() { return this.getAllPlayers({ includeArchived: false }); }

  async switchProfile(fromPlayer, toUUID) {
    const to = await this.get(STORES.player, toUUID);
    if (!to || this._isBanned(to) || to.archivedAt) return false;
    const nowMs = Date.now();
    const sourceUUID = fromPlayer?.UUID || this.getActivePlayerUUID();
    const source = sourceUUID ? await this.get(STORES.player, sourceUUID) : null;
    const puts = [];
    if (source && source.UUID !== to.UUID) {
      puts.push({ store: STORES.player, record: freezePlayerIGT(source, nowMs) });
    }
    puts.push({
      store: STORES.player,
      record: activatePlayerIGT(
        source?.UUID === to.UUID ? source : to,
        nowMs,
      ),
    });
    await this.commitAtomicMutation({
      label: `switch-profile-clock:${sourceUUID || 'none'}:${toUUID}`,
      puts,
      flush: false,
    });
    await this._synchronizePlayerIGTClockRows(
      puts.map((entry) => entry.record),
      'switch-profile-clock-projection',
    );
    this.setActivePlayerUUID(toUUID);
    await this._flushMutationWrite();
    return true;
  }

  async createAndSwitchProfile(fromPlayer, newPlayerData) {
    const nowMs = Date.now();
    const createdAt = getLocalDate(nowMs).toISOString();
    const newPlayer = activatePlayerIGT({
      ...newPlayerData,
      elo: 0,
      igtBaseElo: 0,
      createdAt,
      inGameTime: 0,
    }, nowMs);
    const sourceUUID = fromPlayer?.UUID || this.getActivePlayerUUID();
    const source = sourceUUID ? await this.get(STORES.player, sourceUUID) : null;
    await this.commitAtomicMutation({
      label: `create-and-switch-profile:${newPlayer.UUID}`,
      puts: [
        ...(source && source.UUID !== newPlayer.UUID
          ? [{ store: STORES.player, record: freezePlayerIGT(source, nowMs) }]
          : []),
        { store: STORES.player, record: newPlayer },
      ],
      flush: false,
    });
    await this._synchronizePlayerIGTClockRows(
      [
        ...(source && source.UUID !== newPlayer.UUID
          ? [freezePlayerIGT(source, nowMs)]
          : []),
        newPlayer,
      ],
      'create-profile-clock-projection',
    );
    this.setActivePlayerUUID(newPlayer.UUID);
    await this._flushMutationWrite();
    return newPlayer;
  }

  async _deleteWhere(store, predicate) {
    await this._ensureStoreLoadedForMutation(store, null, 'replace-store');
    const UUIDs = [...this._store(store).values()]
      .filter((record) => predicate(record))
      .map((record) => record?.UUID)
      .filter(Boolean);
    if (!UUIDs.length) return 0;

    // Never mutate the UI cache directly here. In canonical SQLite mode that
    // would make the deletion appear successful until restart while leaving
    // the authoritative rows untouched. Route cascades through the same
    // durable atomic mutation path as every other multi-record command.
    await this.commitAtomicMutation({
      label: `profile-cascade-delete:${store}`,
      deletes: UUIDs.map((UUID) => ({ store, UUID })),
      flush: false,
    });
    return UUIDs.length;
  }

  /* Penalty deletion removes profile identity/progress while preserving the
     household planning system. Universal work is transferred to another live
     profile when possible; journals are retained but detached from identity. */
  async banProfile(playerUUID) {
    if (!playerUUID) return;
    await this.ready;

    const safeDelete = (store, predicate) => this._deleteWhere(store, predicate).catch((err) =>
      console.warn(`[banProfile] failed to wipe ${store}:`, err));

    const fallbackOwner = (await this.getAll(STORES.player))
      .filter((entry) => entry?.UUID && entry.UUID !== playerUUID && !entry.bannedAt && !entry.archivedAt)
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0]?.UUID || null;

    const reparentStore = async (store, transform = null) => {
      const rows = await this.getPlayerStore(store, playerUUID).catch(() => []);
      for (const row of rows) {
        await this.add(store, transform ? transform(row, fallbackOwner) : { ...row, parent: fallbackOwner });
      }
      return rows.length;
    };

    // Journal content survives without an owning profile. Authored comments
    // keep their text but lose the deleted identity association.
    const ownedJournals = await this.getPlayerStore(STORES.journal, playerUUID);
    for (const journal of ownedJournals) await this.add(STORES.journal, { ...journal, parent: null, detachedProfileUUID: playerUUID });
    const comments = await this.getAll(STORES.journalComment).catch(() => []);
    for (const comment of comments.filter((entry) => entry.authorUUID === playerUUID)) {
      await this.add(STORES.journalComment, { ...comment, authorUUID: null, authorNameSnapshot: 'Deleted User' });
    }

    // Planning and definition data is household data, not profile progress.
    const universalStores = [
      STORES.todo, STORES.task, STORES.project, STORES.customEvent, STORES.reminder,
      STORES.goalArea, STORES.goalMilestone, STORES.goalUpdate, STORES.goalLink,
      STORES.rhythmDefinition, STORES.rhythmOpportunity, STORES.actionPlan,
    ];
    for (const store of universalStores) await reparentStore(store);
    await safeDelete(STORES.goalParticipant, (entry) => entry.playerUUID === playerUUID || entry.parent === playerUUID);

    // Delete only profile-bound progress, economy, social, and model data.
    const parentScoped = [
      STORES.event, STORES.transaction,
      STORES.inventory, STORES.notification,
      STORES.eventLog, STORES.eventBuff, STORES.contribution,
      STORES.resource,
      STORES.recommenderEvent, STORES.analyticsEvent,
      STORES.taskCompletionEvent, STORES.taskCompletionReceipt,
      STORES.actionSession, STORES.handoff,
      STORES.interventionDecision, STORES.rewardProvenance,
      STORES.worldConsequenceReceipt, STORES.matchScoreEvent,
      STORES.taskPlanReceipt, STORES.nextMoveDecision,
      STORES.nextMoveFeedback, STORES.nextMoveSurfacePreference,
      STORES.profileContextItem, STORES.profileContextRecipient,
      STORES.profileContextSuggestion, STORES.profileContextPreference,
      STORES.profileContextAudit,
      STORES.chronicleStory, STORES.chronicleDraft,
      STORES.chronicleFeedViewState, STORES.chronicleStoryReadState,
      STORES.chronicleResurfaceState,
      STORES.chronicleEntryAccess, STORES.chronicleEntryRevision,
      STORES.chronicleEntryOperationReceipt, STORES.chronicleEntryConflict,
      STORES.chronicleCollaborationOutbox, STORES.chronicleLegacyNoteMapping,
      STORES.contributionRoadStat, STORES.contributionRoadChoice,
      STORES.contributionRoadUnlock, STORES.contributionRoadMigration,
      STORES.interfaceRevealReceipt,
    ];
    for (const s of parentScoped) await safeDelete(s, (r) => r?.parent === playerUUID);

    // Matches can be owned by an arena or another participant, so parent-only
    // deletion is insufficient. Any match containing the deleted profile is
    // profile progress and must be removed.
    await safeDelete(STORES.match, (match) => matchReferencesProfile(match, playerUUID));

    // Recommender checkpoints, policy weights, experiments, and per-profile
    // preferences live in appSettings. Global household settings have no
    // profile parent and remain untouched.
    await safeDelete(STORES.appSetting, (setting) => String(setting?.parent || '') === String(playerUUID));

    await safeDelete(STORES.friendship,  (f) => Array.isArray(f?.players) && f.players.includes(playerUUID));

    // Scrub identity but keep the record so bannedAt is queryable as metadata.
    const player = await this.get(STORES.player, playerUUID);
    if (player) {
      await this.add(STORES.player, {
        ...player,
        username:        'Deleted User',
        profilePicture:  null,
        activeCosmetics: {},
        bannedAt:        new Date().toISOString(),
      });
    }

    this.clearBanPending(playerUUID);
    this.clearViolations(playerUUID);

    if (this.getActivePlayerUUID() === playerUUID) this.setActivePlayerUUID(null);
    await this._flushMutationWrite();
  }

  /* Permanently wipe a profile and ALL associated data across every store
     that references it. Stores left untouched: shop, notes, customEvent. */
  async wipeProfile(playerUUID) {
    if (!playerUUID) return;
    await this.ready;

    const safeDelete = (store, predicate) => this._deleteWhere(store, predicate).catch((err) =>
      console.warn(`[wipeProfile] failed to wipe ${store}:`, err));

    const fallbackOwner = (await this.getAll(STORES.player))
      .filter((entry) => entry?.UUID && entry.UUID !== playerUUID && !entry.bannedAt && !entry.archivedAt)
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0]?.UUID || null;
    const workspaceDefinitionStores = [
      STORES.todo,
      STORES.project,
      STORES.reminder,
      STORES.goalArea,
      STORES.goalMilestone,
      STORES.goalLink,
    ];
    const ownedPlanning = [];
    for (const store of workspaceDefinitionStores) {
      const rows = await this.getPlayerStore(store, playerUUID).catch(() => []);
      ownedPlanning.push(...rows.map((record) => ({ store, record })));
    }
    if (ownedPlanning.length && !fallbackOwner) {
      const error = new Error('Create or retain another profile before deleting the last profile with workspace planning data.');
      error.code = 'workspace-planning-requires-live-profile';
      throw error;
    }
    for (const { store, record } of ownedPlanning) {
      await this.add(store, {
        ...record,
        parent: fallbackOwner,
        createdByPlayerId: record.createdByPlayerId || playerUUID,
      });
    }
    await safeDelete(STORES.goalParticipant, (entry) => (
      entry.playerUUID === playerUUID || entry.parent === playerUUID
    ));

    // Cascade journal comments by journal ownership AND by author.
    const ownedJournals = await this.getPlayerStore(STORES.journal, playerUUID);
    const journalIDs = new Set(ownedJournals.map((j) => j.UUID).filter(Boolean));
    if (journalIDs.size) await safeDelete(STORES.journalComment, (c) => journalIDs.has(c.journalUUID));
    await safeDelete(STORES.journalComment, (c) => c.authorUUID === playerUUID);
    const ownedStories = await this.getPlayerStore(STORES.chronicleStory, playerUUID);
    const storyIDs = new Set(ownedStories.map((story) => story.UUID).filter(Boolean));
    if (journalIDs.size) {
      await safeDelete(STORES.chronicleEntryMetadata, (record) => journalIDs.has(record.journalUUID || record.UUID));
      await safeDelete(STORES.chronicleEntryLink, (record) => journalIDs.has(record.sourceJournalUUID));
      await safeDelete(STORES.chronicleReaction, (record) => journalIDs.has(record.journalUUID));
      await safeDelete(STORES.chronicleEntryAccess, (record) => journalIDs.has(record.journalUUID || record.UUID));
      await safeDelete(STORES.chronicleEntryRevision, (record) => journalIDs.has(record.entryUUID));
      await safeDelete(STORES.chronicleEntryOperationReceipt, (record) => journalIDs.has(record.entryUUID));
      await safeDelete(STORES.chronicleEntryConflict, (record) => journalIDs.has(record.entryUUID));
      await safeDelete(STORES.chronicleCollaborationOutbox, (record) => journalIDs.has(record.entryUUID));
    }
    if (storyIDs.size) {
      await safeDelete(STORES.chronicleStoryEntry, (record) => storyIDs.has(record.storyUUID || record.parent));
    }
    await safeDelete(STORES.chronicleReaction, (record) => record.reactorUUID === playerUUID);

    // Every store keyed by `parent`.
    const parentScoped = [
      STORES.task, STORES.journal, STORES.event, STORES.transaction,
      STORES.inventory, STORES.match, STORES.notification,
      STORES.eventLog, STORES.eventBuff, STORES.contribution,
      STORES.resource,
      STORES.recommenderEvent, STORES.analyticsEvent,
      STORES.taskCompletionEvent, STORES.taskCompletionReceipt,
      STORES.profileContextItem, STORES.profileContextRecipient,
      STORES.profileContextSuggestion, STORES.profileContextPreference,
      STORES.profileContextAudit,
      STORES.taskPlanReceipt, STORES.nextMoveDecision,
      STORES.nextMoveFeedback, STORES.nextMoveSurfacePreference,
      STORES.chronicleStory, STORES.chronicleDraft,
      STORES.chronicleFeedViewState, STORES.chronicleStoryReadState,
      STORES.chronicleResurfaceState,
      STORES.chronicleEntryAccess, STORES.chronicleEntryRevision,
      STORES.chronicleEntryOperationReceipt, STORES.chronicleEntryConflict,
      STORES.chronicleCollaborationOutbox, STORES.chronicleLegacyNoteMapping,
      STORES.contributionRoadStat, STORES.contributionRoadChoice,
      STORES.contributionRoadUnlock, STORES.contributionRoadMigration,
      STORES.interfaceRevealReceipt,
    ];
    for (const s of parentScoped) await safeDelete(s, (r) => r?.parent === playerUUID);

    await safeDelete(STORES.friendship,  (f) => Array.isArray(f?.players) && f.players.includes(playerUUID));

    await this.remove(STORES.player, playerUUID).catch((err) => console.warn('[wipeProfile] remove player:', err));

    this.clearBanPending(playerUUID);
    this.clearViolations(playerUUID);

    if (this.getActivePlayerUUID() === playerUUID) this.setActivePlayerUUID(null);
    await this._flushMutationWrite();
  }
}
export default ProfileLifecycleService;
