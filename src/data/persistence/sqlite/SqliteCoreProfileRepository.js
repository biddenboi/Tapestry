import {
  asObject,
  currencyFromMinor,
  nonNegativeNumber,
  parseJson,
  stableJson,
  textOrNull,
} from './shadowDomainUtils.js';
import { deserializeProfilePictureValue } from '../profilePictureValue.js';
import SqliteSocialWorldRepository from './SqliteSocialWorldRepository.js';
import SqliteSocialWorldProfileSwitchCoordinator from './SqliteSocialWorldProfileSwitchCoordinator.js';

function hydratePlayer(row, cosmetics = []) {
  if (!row) return null;
  const extra = parseJson(row.extraJson, {});
  const activeCosmetics = Object.fromEntries(cosmetics.map((entry) => [entry.slot, parseJson(entry.valueJson, null)]));
  return {
    ...extra,
    UUID: row.id,
    username: row.username,
    description: row.description,
    profilePicture: deserializeProfilePictureValue(row.profilePicture),
    elo: Number(row.elo),
    igtBaseElo: Number(row.igtBaseElo),
    tokens: Number(row.tokens),
    minutesClearedToday: Number(row.minutesClearedToday),
    inGameTime: Number(row.inGameTime),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    bannedAt: row.bannedAt,
    activeCosmetics,
  };
}

const PLAYER_SELECT = `
SELECT id, username, description, profile_picture AS profilePicture,
       elo, igt_base_elo AS igtBaseElo, tokens,
       minutes_cleared_today AS minutesClearedToday,
       in_game_time AS inGameTime,
       created_at AS createdAt, updated_at AS updatedAt,
       archived_at AS archivedAt, banned_at AS bannedAt,
       extra_json AS extraJson
FROM players
`.trim();

export class SqliteCoreProfileRepository {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('SqliteCoreProfileRepository requires a SQLite client.');
    this.client = client;
    this.now = now;
    this.socialWorldProfileSwitch = new SqliteSocialWorldProfileSwitchCoordinator({
      client,
      presenceRepository: new SqliteSocialWorldRepository({ client, now }),
      now,
    });
  }

  async _cosmeticsForPlayers(playerIds) {
    if (!playerIds.length) return new Map();
    const placeholders = playerIds.map(() => '?').join(',');
    const rows = await this.client.query({
      sql: `SELECT player_id AS playerId, slot, value_json AS valueJson
            FROM player_cosmetics WHERE player_id IN (${placeholders}) ORDER BY player_id, slot`,
      bind: playerIds,
      result: 'all',
    });
    const map = new Map(playerIds.map((id) => [String(id), []]));
    for (const row of rows) map.get(String(row.playerId))?.push(row);
    return map;
  }

  async getPlayer(playerId) {
    const row = await this.client.query({ sql: `${PLAYER_SELECT} WHERE id=?`, bind: [playerId], result: 'one' });
    if (!row) return null;
    const cosmetics = await this._cosmeticsForPlayers([row.id]);
    return hydratePlayer(row, cosmetics.get(String(row.id)) || []);
  }

  async listPlayers({ includeArchived = true, includeBanned = false } = {}) {
    const rows = await this.client.query({
      sql: `${PLAYER_SELECT} ORDER BY created_at DESC, id`,
      result: 'all',
    });
    const cosmetics = await this._cosmeticsForPlayers(rows.map((row) => row.id));
    return rows
      .map((row) => hydratePlayer(row, cosmetics.get(String(row.id)) || []))
      .filter((player) => includeArchived || !player.archivedAt)
      .filter((player) => includeBanned || !player.bannedAt);
  }

  async getAppState() {
    const row = await this.client.query({
      sql: `SELECT active_player_id AS activePlayerUUID,
                   pending_customization_json AS pendingCustomizationJson
            FROM app_state WHERE singleton_id=1`,
      result: 'one',
    });
    const violations = await this.client.query({
      sql: 'SELECT player_id AS playerId, strikes, igt_day AS igtDay FROM profile_violations ORDER BY player_id',
      result: 'all',
    });
    const pending = await this.client.query({
      sql: 'SELECT player_id AS playerId FROM profile_ban_pending WHERE pending=1 ORDER BY player_id',
      result: 'all',
    });
    return {
      activePlayerUUID: row?.activePlayerUUID || null,
      pendingCustomization: parseJson(row?.pendingCustomizationJson, {
        playerImages: {}, eventBanners: {}, shopImages: {}, journalImages: {},
      }),
      violations: Object.fromEntries(violations.map((entry) => [entry.playerId, {
        strikes: Number(entry.strikes), igtDay: Number(entry.igtDay),
      }])),
      banPending: Object.fromEntries(pending.map((entry) => [entry.playerId, true])),
    };
  }

  async getEconomy() {
    const amount = await this.client.query({
      sql: 'SELECT global_money_minor FROM economy WHERE singleton_id=1',
      result: 'value',
    });
    return { globalMoney: currencyFromMinor(amount) };
  }

  async getSettings({ playerId = undefined } = {}) {
    const where = playerId === undefined ? '' : ' WHERE player_id IS ?';
    const rows = await this.client.query({
      sql: `SELECT id,player_id AS playerId,setting_key AS settingKey,value_json AS valueJson,
                   created_at AS createdAt,updated_at AS updatedAt,extra_json AS extraJson
            FROM settings${where} ORDER BY id`,
      bind: playerId === undefined ? [] : [playerId],
      result: 'all',
    });
    return rows.map((row) => ({
      ...parseJson(row.extraJson, {}),
      UUID: row.id,
      ...(row.playerId ? { parent: row.playerId } : {}),
      ...(row.settingKey ? { settingKey: row.settingKey } : {}),
      value: parseJson(row.valueJson, null),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async getCurrentPlayer() {
    const appState = await this.getAppState();
    if (appState.activePlayerUUID) {
      const active = await this.getPlayer(appState.activePlayerUUID);
      if (active && !active.bannedAt) return active;
    }
    return (await this.listPlayers({ includeArchived: true, includeBanned: false }))[0] || null;
  }

  async switchProfile(options = {}) {
    const result = await this.socialWorldProfileSwitch.switchProfile(options);
    return {
      ...result,
      player: options.toPlayerId ? await this.getPlayer(options.toPlayerId) : null,
    };
  }

  async setViolations(playerId, { strikes = 0, igtDay = 0, operationId } = {}) {
    if (!playerId || !operationId) throw new Error('Violation updates require a player and operation ID.');
    const timestamp = this.now().toISOString();
    await this.client.executeAtomic({
      commandId: `profile-violations:${operationId}`,
      label: 'profile-violations-shadow',
      statements: [{
        sql: `INSERT INTO profile_violations(player_id,strikes,igt_day,updated_at) VALUES(?,?,?,?)
              ON CONFLICT(player_id) DO UPDATE SET strikes=excluded.strikes, igt_day=excluded.igt_day, updated_at=excluded.updated_at`,
        bind: [playerId, Math.max(0, Math.trunc(Number(strikes) || 0)), Math.trunc(Number(igtDay) || 0), timestamp],
        result: 'changes',
      }],
    });
    return (await this.getAppState()).violations[playerId] || null;
  }

  async setBanPending(playerId, { pending = true, operationId } = {}) {
    if (!playerId || !operationId) throw new Error('Ban-pending updates require a player and operation ID.');
    const timestamp = this.now().toISOString();
    await this.client.executeAtomic({
      commandId: `profile-ban-pending:${operationId}`,
      label: 'profile-ban-pending-shadow',
      statements: [pending ? {
        sql: `INSERT INTO profile_ban_pending(player_id,pending,updated_at) VALUES(?,1,?)
              ON CONFLICT(player_id) DO UPDATE SET pending=1, updated_at=excluded.updated_at`,
        bind: [playerId, timestamp], result: 'changes',
      } : {
        sql: 'DELETE FROM profile_ban_pending WHERE player_id=?', bind: [playerId], result: 'changes',
      }],
    });
    return Boolean((await this.getAppState()).banPending[playerId]);
  }

  async banProfile(playerId, { operationId, now = this.now() } = {}) {
    return this._deleteProfile(playerId, { operationId, now, action: 'ban' });
  }

  async wipeProfile(playerId, { operationId, now = this.now() } = {}) {
    return this._deleteProfile(playerId, { operationId, now, action: 'wipe' });
  }

  async _deleteProfile(playerId, { operationId, now, action }) {
    if (!playerId || !operationId) throw new Error(`${action} requires a player and operation ID.`);
    const player = await this.getPlayer(playerId);
    if (!player) return { status: 'missing', playerId };
    const fallbackCandidate = await this.client.query({
      sql: `SELECT id FROM players
            WHERE id<>? AND banned_at IS NULL AND archived_at IS NULL
            ORDER BY created_at DESC,id LIMIT 1`,
      bind: [playerId],
      result: 'value',
    }) || null;
    if (action === 'wipe' && !fallbackCandidate) {
      const sharedPlanningCount = Number(await this.client.query({
        sql: `SELECT
                (SELECT COUNT(*) FROM projects WHERE player_id=?)
              + (SELECT COUNT(*) FROM todos WHERE player_id=?)
              + (SELECT COUNT(*) FROM reminders WHERE player_id=?)
              + (SELECT COUNT(*) FROM goal_areas WHERE player_id=?)
              + (SELECT COUNT(*) FROM goal_milestones WHERE player_id=?)
              + (SELECT COUNT(*) FROM goal_links WHERE player_id=?)`,
        bind: Array(6).fill(playerId),
        result: 'value',
      }) || 0);
      if (sharedPlanningCount > 0) {
        const error = new Error('Create or retain another profile before deleting the last profile with workspace planning data.');
        error.code = 'workspace-planning-requires-live-profile';
        throw error;
      }
    }
    const fallbackOwner = fallbackCandidate || playerId;
    const countSpecs = {
      tasks: ['tasks', 'player_id'],
      todos: ['todos', 'player_id'],
      projects: ['projects', 'player_id'],
      reminders: ['reminders', 'player_id'],
      settings: ['settings', 'player_id'],
      playerCosmetics: ['player_cosmetics', 'player_id'],
      playerTitles: ['player_titles', 'player_id'],
      notesDetached: ['notes', 'player_id'],
      journalsDetached: ['journals', 'player_id'],
      matchOwnershipDetached: ['matches', 'owner_player_id'],
      matchParticipantsAnonymized: ['match_participants', 'player_id'],
      matchEloReceiptsAnonymized: ['match_elo_receipts', 'player_id'],
      lifecycleEventsAnonymized: ['lifecycle_events', 'player_id'],
      customEventsAnonymized: ['custom_events', 'owner_player_id'],
      eventLogsAnonymized: ['event_logs', 'player_id'],
      eventBuffsDeleted: ['event_buffs', 'player_id'],
      contributionsAnonymized: ['contributions', 'player_id'],
      inventoryDeleted: ['inventory_items', 'player_id'],
      purchaseBatchesAnonymized: ['purchase_batches', 'player_id'],
      purchaseLedgerAnonymized: ['purchase_ledger', 'player_id'],
      friendshipsDeleted: ['friendship_members', 'player_id'],
      notificationsDeleted: ['notifications', 'recipient_player_id'],
      presenceIntervalsDeleted: ['semantic_presence_intervals', 'player_id'],
      dojoSessionRollupsDeleted: ['dojo_session_rollups', 'player_id'],
      castAssignmentsViewerDeleted: ['social_cast_assignments', 'viewer_player_id'],
      castAssignmentsSubjectDeleted: ['social_cast_assignments', 'subject_player_id'],
      castReviewsViewerDeleted: ['social_cast_reviews', 'viewer_player_id'],
      achievementEventsAnonymized: ['achievement_events', 'player_id'],
      achievementStatesDeleted: ['achievement_states', 'player_id'],
      achievementReceiptsAnonymized: ['achievement_receipts', 'player_id'],
      recommendationEventsDeleted: ['recommendation_events', 'player_id'],
      modelSettingsDeleted: ['model_settings', 'player_id'],
      analyticsEventsDeleted: ['analytics_events', 'player_id'],
    };
    const counts = {};
    for (const [name, [table, column]] of Object.entries(countSpecs)) {
      counts[name] = Number(await this.client.query({
        sql: `SELECT COUNT(*) FROM ${table} WHERE ${column}=?`, bind: [playerId], result: 'value',
      }) || 0);
    }
    const timestamp = now.toISOString();
    const auditId = `profile-${action}-${operationId}`;
    const retainedHistorical = {
      matchOwnership: counts.matchOwnershipDetached,
      matchParticipants: counts.matchParticipantsAnonymized,
      matchEloReceipts: counts.matchEloReceiptsAnonymized,
      lifecycleEvents: counts.lifecycleEventsAnonymized,
      customEvents: counts.customEventsAnonymized,
      eventLogs: counts.eventLogsAnonymized,
      contributions: counts.contributionsAnonymized,
      purchaseBatches: counts.purchaseBatchesAnonymized,
      purchaseLedger: counts.purchaseLedgerAnonymized,
      achievementEvents: counts.achievementEventsAnonymized,
      achievementReceipts: counts.achievementReceiptsAnonymized,
    };
    const retained = action === 'ban'
      ? {
          todos: counts.todos,
          tasks: counts.tasks,
          projects: counts.projects,
          reminders: counts.reminders,
          notes: counts.notesDetached,
          journalsDetached: counts.journalsDetached,
          historical: retainedHistorical,
          deletedCurrent: {
            eventBuffs: counts.eventBuffsDeleted,
            inventory: counts.inventoryDeleted,
            friendships: counts.friendshipsDeleted,
            notifications: counts.notificationsDeleted,
            achievementStates: counts.achievementStatesDeleted,
            recommendationEvents: counts.recommendationEventsDeleted,
            modelSettings: counts.modelSettingsDeleted,
            analyticsEvents: counts.analyticsEventsDeleted,
            presenceIntervals: counts.presenceIntervalsDeleted,
            dojoSessionRollups: counts.dojoSessionRollupsDeleted,
            castAssignments: counts.castAssignmentsViewerDeleted + counts.castAssignmentsSubjectDeleted,
            castReviews: counts.castReviewsViewerDeleted,
          },
        }
      : {
          notesDetached: counts.notesDetached,
          journalsDetached: counts.journalsDetached,
          historical: retainedHistorical,
          deletedCurrent: {
            eventBuffs: counts.eventBuffsDeleted,
            inventory: counts.inventoryDeleted,
            friendships: counts.friendshipsDeleted,
            notifications: counts.notificationsDeleted,
            achievementStates: counts.achievementStatesDeleted,
            recommendationEvents: counts.recommendationEventsDeleted,
            modelSettings: counts.modelSettingsDeleted,
            analyticsEvents: counts.analyticsEventsDeleted,
            presenceIntervals: counts.presenceIntervalsDeleted,
            dojoSessionRollups: counts.dojoSessionRollupsDeleted,
            castAssignments: counts.castAssignmentsViewerDeleted + counts.castAssignmentsSubjectDeleted,
            castReviews: counts.castReviewsViewerDeleted,
          },
        };
    const statements = [];
    if (action === 'ban') {
      statements.push(
        { sql: 'UPDATE projects SET player_id=? WHERE player_id=?', bind: [fallbackOwner, playerId], result: 'changes' },
        { sql: 'UPDATE todos SET player_id=? WHERE player_id=?', bind: [fallbackOwner, playerId], result: 'changes' },
        { sql: 'UPDATE tasks SET player_id=? WHERE player_id=?', bind: [fallbackOwner, playerId], result: 'changes' },
        { sql: 'UPDATE reminders SET player_id=? WHERE player_id=?', bind: [fallbackOwner, playerId], result: 'changes' },
        { sql: 'UPDATE custom_events SET owner_player_id=? WHERE owner_player_id=?', bind: [fallbackOwner, playerId], result: 'changes' },
        { sql: 'UPDATE journals SET player_id=NULL WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'UPDATE notes SET player_id=NULL WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM matches WHERE owner_player_id=? OR id IN (SELECT match_id FROM match_participants WHERE player_id=?)', bind: [playerId, playerId], result: 'changes' },
        { sql: 'DELETE FROM event_logs WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM contributions WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM purchase_batches WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM purchase_ledger WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM player_cosmetics WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM player_titles WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM settings WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM event_buffs WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM inventory_items WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM friendships WHERE requester_player_id=? OR recipient_player_id=?', bind: [playerId, playerId], result: 'changes' },
        { sql: 'DELETE FROM notifications WHERE recipient_player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM dojo_session_rollups WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM semantic_presence_intervals WHERE player_id=?', bind: [playerId], result: 'changes' },
        {
          sql: `UPDATE social_cast_reviews
                SET review_after_igt=reviewed_at_igt,updated_at=?
                WHERE viewer_player_id IN (
                  SELECT viewer_player_id FROM social_cast_assignments WHERE subject_player_id=?
                )`,
          bind: [timestamp, playerId], result: 'changes',
        },
        { sql: 'DELETE FROM social_cast_reviews WHERE viewer_player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM social_cast_assignments WHERE viewer_player_id=? OR subject_player_id=?', bind: [playerId, playerId], result: 'changes' },
        { sql: 'UPDATE achievement_events SET player_id=NULL WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'UPDATE achievement_receipts SET player_id=NULL WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM achievement_states WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM recommendation_events WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM model_settings WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM analytics_events WHERE player_id=?', bind: [playerId], result: 'changes' },
        {
          sql: `UPDATE players SET username='Deleted User', profile_picture=NULL,
                description=NULL, banned_at=?, updated_at=? WHERE id=?`,
          bind: [timestamp, timestamp, playerId], result: 'changes',
        },
        { sql: 'DELETE FROM profile_ban_pending WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM profile_violations WHERE player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'UPDATE app_state SET active_player_id=NULL, updated_at=? WHERE active_player_id=?', bind: [timestamp, playerId], result: 'changes' },
      );
    } else {
      statements.push(
        { sql: 'UPDATE notes SET player_id=NULL WHERE player_id=?', bind: [playerId], result: 'changes' },
        {
          sql: `UPDATE social_cast_reviews
                SET review_after_igt=reviewed_at_igt,updated_at=?
                WHERE viewer_player_id IN (
                  SELECT viewer_player_id FROM social_cast_assignments WHERE subject_player_id=?
                )`,
          bind: [timestamp, playerId], result: 'changes',
        },
        { sql: 'DELETE FROM social_cast_reviews WHERE viewer_player_id=?', bind: [playerId], result: 'changes' },
        { sql: 'DELETE FROM players WHERE id=?', bind: [playerId], result: 'changes' },
      );
    }
    statements.push({
      sql: `INSERT INTO profile_deletion_audits(audit_id,player_id,action,counts_json,retained_json,committed_at)
            VALUES(?,?,?,?,?,?)`,
      bind: [auditId, playerId, action, stableJson(counts), stableJson(retained), timestamp],
      result: 'changes',
    });
    const result = await this.client.executeAtomic({
      commandId: `profile-${action}:${operationId}`,
      label: `profile-${action}-shadow`,
      statements,
    });
    return { status: action === 'ban' ? 'banned' : 'wiped', duplicate: result.duplicate, playerId, counts, retained, auditId };
  }

  async getDeletionAudit(auditId) {
    const row = await this.client.query({
      sql: `SELECT audit_id AS auditId,player_id AS playerId,action,counts_json AS countsJson,
                   retained_json AS retainedJson,committed_at AS committedAt
            FROM profile_deletion_audits WHERE audit_id=?`,
      bind: [auditId], result: 'one',
    });
    return row ? { ...row, counts: parseJson(row.countsJson, {}), retained: parseJson(row.retainedJson, {}) } : null;
  }
}

export default SqliteCoreProfileRepository;
