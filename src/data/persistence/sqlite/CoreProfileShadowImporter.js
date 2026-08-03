import {
  asObject,
  createImportLedgerStatements,
  currencyToMinor,
  deterministicRows,
  fingerprintShadowSource,
  nonNegativeNumber,
  omitKeys,
  stableJson,
  textOrNull,
} from './shadowDomainUtils.js';
import { serializeProfilePictureValue } from '../profilePictureValue.js';

const IMPORTER_VERSION = 'workspace-profiles-v2';
const PLAYER_COLUMNS = Object.freeze([
  'UUID', 'username', 'description', 'profilePicture', 'elo', 'igtBaseElo',
  'tokens', 'minutesClearedToday', 'inGameTime',
  'createdAt', 'updatedAt', 'archivedAt', 'bannedAt',
  'activeCosmetics',
]);
const SETTING_COLUMNS = Object.freeze([
  'UUID', 'parent', 'playerUUID', 'key', 'settingKey', 'value', 'createdAt', 'updatedAt',
]);

function normalizePendingCustomization(value) {
  const pending = asObject(value);
  return {
    playerImages: asObject(pending.playerImages),
    eventBanners: asObject(pending.eventBanners),
    shopImages: asObject(pending.shopImages),
    journalImages: asObject(pending.journalImages),
  };
}

function playerStatements(player) {
  const id = String(player.UUID);
  const elo = nonNegativeNumber(player.elo ?? player.igtBaseElo, 0);
  const baseElo = nonNegativeNumber(player.igtBaseElo ?? player.elo, elo);
  const statements = [{
    sql: `
INSERT INTO players(
  id,username,description,profile_picture,elo,igt_base_elo,tokens,
  minutes_cleared_today,in_game_time,created_at,updated_at,
  archived_at,banned_at,extra_json
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET
  username=excluded.username, description=excluded.description,
  profile_picture=excluded.profile_picture, elo=excluded.elo,
  igt_base_elo=excluded.igt_base_elo, tokens=excluded.tokens,
  minutes_cleared_today=excluded.minutes_cleared_today,
  in_game_time=excluded.in_game_time,
  created_at=excluded.created_at, updated_at=excluded.updated_at,
  archived_at=excluded.archived_at, banned_at=excluded.banned_at,
  extra_json=excluded.extra_json
`.trim(),
    bind: [
      id,
      textOrNull(player.username),
      textOrNull(player.description),
      serializeProfilePictureValue(player.profilePicture),
      elo,
      baseElo,
      nonNegativeNumber(player.tokens, 0),
      Number.isFinite(Number(player.minutesClearedToday)) ? Number(player.minutesClearedToday) : 0,
      Math.max(0, Math.trunc(Number(player.inGameTime) || 0)),
      textOrNull(player.createdAt),
      textOrNull(player.updatedAt),
      textOrNull(player.archivedAt),
      textOrNull(player.bannedAt),
      stableJson(omitKeys(player, PLAYER_COLUMNS)),
    ],
    result: 'changes',
  }, {
    sql: `INSERT INTO workspace_profiles(workspace_id,player_id,joined_at)
          SELECT 'workspace:default',id,COALESCE(created_at,'1970-01-01T00:00:00.000Z')
          FROM players WHERE id=? AND archived_at IS NULL AND banned_at IS NULL
          ON CONFLICT(workspace_id,player_id) DO NOTHING`,
    bind: [id],
    result: 'changes',
  }, {
    sql: `DELETE FROM workspace_profiles
          WHERE workspace_id='workspace:default' AND player_id=?
            AND EXISTS(SELECT 1 FROM players WHERE id=? AND (archived_at IS NOT NULL OR banned_at IS NOT NULL))`,
    bind: [id, id],
    result: 'changes',
  }, {
    sql: 'DELETE FROM player_cosmetics WHERE player_id=?',
    bind: [id],
    result: 'changes',
  }, {
    sql: 'DELETE FROM player_titles WHERE player_id=?',
    bind: [id],
    result: 'changes',
  }];

  const cosmetics = asObject(player.activeCosmetics);
  for (const slot of Object.keys(cosmetics).sort()) {
    statements.push({
      sql: 'INSERT INTO player_cosmetics(player_id,slot,value_json) VALUES(?,?,?)',
      bind: [id, slot, stableJson(cosmetics[slot])],
      result: 'changes',
    });
  }
  if (cosmetics.title != null && cosmetics.title !== '') {
    statements.push({
      sql: 'INSERT INTO player_titles(player_id,title_id,active,metadata_json) VALUES(?,?,1,?)',
      bind: [id, String(cosmetics.title), '{}'],
      result: 'changes',
    });
  }
  return statements;
}

export class CoreProfileShadowImporter {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('CoreProfileShadowImporter requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async import({
    players = [],
    appState = {},
    economyState = {},
    settings = [],
    runId = null,
  } = {}) {
    const source = { players, appState, economyState, settings };
    const sourceFingerprint = await fingerprintShadowSource(source);
    const existing = await this.client.query({
      sql: `SELECT run_id AS runId, counts_json AS countsJson, diagnostics_json AS diagnosticsJson
            FROM shadow_import_runs
            WHERE domain='core-profiles' AND source_fingerprint=? AND importer_version=?`,
      bind: [sourceFingerprint, IMPORTER_VERSION],
      result: 'one',
    });
    if (existing) {
      return {
        duplicate: true,
        runId: existing.runId,
        sourceFingerprint,
        counts: JSON.parse(existing.countsJson),
        diagnostics: JSON.parse(existing.diagnosticsJson),
      };
    }

    const playerInput = deterministicRows(players, { kind: 'player' });
    const settingInput = deterministicRows(settings, { kind: 'setting' });
    const selectedPlayers = playerInput.selected;
    const playerIds = new Set(selectedPlayers.map((player) => String(player.UUID)));
    const diagnostics = [
      ...playerInput.rejected,
      ...playerInput.conflicts,
      ...settingInput.rejected,
      ...settingInput.conflicts,
    ];
    const timestamp = this.now().toISOString();
    const effectiveRunId = runId || `core-profiles:${sourceFingerprint.slice(0, 24)}`;
    const statements = [];

    for (const player of selectedPlayers) statements.push(...playerStatements(player));

    for (const setting of settingInput.selected) {
      const candidatePlayerId = textOrNull(setting.parent ?? setting.playerUUID);
      const playerId = candidatePlayerId && playerIds.has(candidatePlayerId) ? candidatePlayerId : null;
      if (candidatePlayerId && !playerId) {
        diagnostics.push({ kind: 'setting', recordId: setting.UUID, reason: 'unknown-player', playerId: candidatePlayerId });
      }
      statements.push({
        sql: `
INSERT INTO settings(id,player_id,setting_key,value_json,created_at,updated_at,extra_json)
VALUES(?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET
  player_id=excluded.player_id, setting_key=excluded.setting_key,
  value_json=excluded.value_json, created_at=excluded.created_at,
  updated_at=excluded.updated_at, extra_json=excluded.extra_json
`.trim(),
        bind: [
          String(setting.UUID),
          playerId,
          textOrNull(setting.settingKey ?? setting.key),
          stableJson(Object.prototype.hasOwnProperty.call(setting, 'value') ? setting.value : setting),
          textOrNull(setting.createdAt),
          textOrNull(setting.updatedAt),
          stableJson(omitKeys(setting, SETTING_COLUMNS)),
        ],
        result: 'changes',
      });
    }

    const state = asObject(appState);
    const requestedActive = textOrNull(state.activePlayerUUID);
    const activePlayerId = requestedActive && playerIds.has(requestedActive) ? requestedActive : null;
    if (requestedActive && !activePlayerId) {
      diagnostics.push({ kind: 'app-state', reason: 'unknown-active-player', playerId: requestedActive });
    }
    statements.push({
      sql: `
INSERT INTO app_state(singleton_id,active_player_id,pending_customization_json,updated_at)
VALUES(1,?,?,?)
ON CONFLICT(singleton_id) DO UPDATE SET
  active_player_id=excluded.active_player_id,
  pending_customization_json=excluded.pending_customization_json,
  updated_at=excluded.updated_at
`.trim(),
      bind: [activePlayerId, stableJson(normalizePendingCustomization(state.pendingCustomization)), timestamp],
      result: 'changes',
    });

    for (const [playerId, raw] of Object.entries(asObject(state.violations)).sort(([a], [b]) => a.localeCompare(b))) {
      if (!playerIds.has(playerId)) {
        diagnostics.push({ kind: 'violation', reason: 'unknown-player', playerId });
        continue;
      }
      const record = asObject(raw);
      statements.push({
        sql: `INSERT INTO profile_violations(player_id,strikes,igt_day,updated_at)
              VALUES(?,?,?,?)
              ON CONFLICT(player_id) DO UPDATE SET strikes=excluded.strikes, igt_day=excluded.igt_day, updated_at=excluded.updated_at`,
        bind: [playerId, Math.max(0, Math.trunc(Number(record.strikes) || 0)), Math.trunc(Number(record.igtDay) || 0), timestamp],
        result: 'changes',
      });
    }

    for (const [playerId, pending] of Object.entries(asObject(state.banPending)).sort(([a], [b]) => a.localeCompare(b))) {
      if (!pending) continue;
      if (!playerIds.has(playerId)) {
        diagnostics.push({ kind: 'ban-pending', reason: 'unknown-player', playerId });
        continue;
      }
      statements.push({
        sql: `INSERT INTO profile_ban_pending(player_id,pending,updated_at) VALUES(?,1,?)
              ON CONFLICT(player_id) DO UPDATE SET pending=1, updated_at=excluded.updated_at`,
        bind: [playerId, timestamp],
        result: 'changes',
      });
    }

    const globalMoney = nonNegativeNumber(asObject(economyState).globalMoney, 0);
    statements.push({
      sql: `INSERT INTO economy(singleton_id,global_money_minor,updated_at) VALUES(1,?,?)
            ON CONFLICT(singleton_id) DO UPDATE SET global_money_minor=excluded.global_money_minor, updated_at=excluded.updated_at`,
      bind: [currencyToMinor(globalMoney), timestamp],
      result: 'changes',
    });

    const counts = {
      players: selectedPlayers.length,
      settings: settingInput.selected.length,
      cosmetics: selectedPlayers.reduce((sum, player) => sum + Object.keys(asObject(player.activeCosmetics)).length, 0),
      violations: Object.keys(asObject(state.violations)).filter((id) => playerIds.has(id)).length,
      banPending: Object.entries(asObject(state.banPending)).filter(([id, pending]) => playerIds.has(id) && pending).length,
      globalMoney,
      diagnostics: diagnostics.length,
    };
    statements.push(...createImportLedgerStatements({
      runId: effectiveRunId,
      domain: 'core-profiles',
      sourceFingerprint,
      importerVersion: IMPORTER_VERSION,
      startedAt: timestamp,
      finishedAt: timestamp,
      counts,
      diagnostics,
    }));

    const result = await this.client.executeAtomic({
      commandId: `shadow-import:${effectiveRunId}`,
      label: 'shadow-import-core-profiles',
      statements,
    });
    return { duplicate: result.duplicate, runId: effectiveRunId, sourceFingerprint, counts, diagnostics };
  }
}

export default CoreProfileShadowImporter;
