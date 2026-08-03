import { SEMANTIC_LOCATION } from '../../../domain/social-world/SocialWorldContracts.js';
import {
  activatePlayerIGT,
  freezePlayerIGT,
  migratePlayerIGTClock,
  PROFILE_IGT_ACTIVITY_RECOVERY_VERSION,
} from '../../../domain/time/Time.js';
import { parseJson } from './shadowDomainUtils.js';
import { bumpSourceVersionStatements } from './sourceVersionUtils.js';

const PRESENCE_INVALIDATIONS = Object.freeze(['presence', 'socialWorld']);

function asISO(value, fallback) {
  const date = value instanceof Date ? value : new Date(value || fallback());
  if (!Number.isFinite(date.getTime())) throw new TypeError('A valid profile-switch timestamp is required.');
  return date.toISOString();
}

function runtimePlayer(row, overrides = {}) {
  return {
    ...parseJson(row?.extraJson, {}),
    ...row,
    UUID: row?.id,
    ...overrides,
  };
}

function playerClockUpdate(player, at) {
  return {
    sql: `UPDATE players
          SET in_game_time=?,updated_at=?,
              extra_json=json_set(
                extra_json,
                '$.igtClockVersion',?,
                '$.igtActivityRecoveryVersion',?,
                '$.igtActive',json(?),
                '$.igtLastActiveDate',?
              )
          WHERE id=? AND banned_at IS NULL`,
    bind: [
      Math.max(0, Math.trunc(Number(player?.inGameTime) || 0)),
      at,
      Math.max(2, Math.trunc(Number(player?.igtClockVersion) || 0)),
      Math.max(
        PROFILE_IGT_ACTIVITY_RECOVERY_VERSION,
        Math.trunc(Number(player?.igtActivityRecoveryVersion) || 0),
      ),
      player?.igtActive ? 'true' : 'false',
      player?.igtLastActiveDate || null,
      player?.UUID,
    ],
    result: 'changes',
  };
}

function finalActiveElapsed(interval, atMs) {
  const stored = Math.max(0, Number(interval?.activeElapsedMs || 0));
  if (!interval?.tracksActiveElapsed || !interval.activeAnchorAt) return Math.trunc(stored);
  const anchor = new Date(interval.activeAnchorAt).getTime();
  return Math.trunc(stored + (Number.isFinite(anchor) ? Math.max(0, atMs - anchor) : 0));
}

export class SqliteSocialWorldProfileSwitchCoordinator {
  constructor({ client, presenceRepository, now = () => new Date() } = {}) {
    if (!client?.query || !client?.executeAtomic || !presenceRepository) {
      throw new Error('Profile switch coordination requires a SQLite client and presence repository.');
    }
    this.client = client;
    this.presenceRepository = presenceRepository;
    this.now = now;
  }

  async _player(playerId) {
    if (!playerId) return null;
    return this.client.query({
      sql: `SELECT id,in_game_time AS inGameTime,created_at AS createdAt,
                   updated_at AS updatedAt,banned_at AS bannedAt,
                   extra_json AS extraJson
            FROM players WHERE id=?`,
      bind: [playerId],
      result: 'one',
    });
  }

  async switchProfile({
    fromPlayerId = null,
    toPlayerId,
    operationId,
    now = this.now(),
    commonsVisible = false,
    commonsIntervalId = null,
  } = {}) {
    if (!toPlayerId || !operationId) throw new Error('Profile switching requires a target and operation ID.');
    if (commonsVisible && !commonsIntervalId) {
      throw new Error('Opening Commons during profile switch requires an interval ID.');
    }
    const [outgoing, incoming] = await Promise.all([
      fromPlayerId ? this._player(fromPlayerId) : null,
      this._player(toPlayerId),
    ]);
    if (!incoming || incoming.bannedAt) return { status: 'invalid-target', duplicate: false };

    const at = asISO(now, this.now);
    const atMs = new Date(at).getTime();
    const sameProfile = outgoing?.id === incoming.id;
    const outgoingClock = outgoing
      ? (sameProfile
        ? activatePlayerIGT(
          migratePlayerIGTClock(runtimePlayer(outgoing), { active: true, nowMs: atMs }),
          atMs,
        )
        : freezePlayerIGT(
          migratePlayerIGTClock(runtimePlayer(outgoing), { active: true, nowMs: atMs }),
          atMs,
        ))
      : null;
    const incomingClock = sameProfile
      ? outgoingClock
      : activatePlayerIGT(
        migratePlayerIGTClock(runtimePlayer(incoming), { active: false, nowMs: atMs }),
        atMs,
      );
    const outgoingIGT = outgoingClock
      ? Math.trunc(outgoingClock.inGameTime)
      : null;
    const incomingIGT = Math.trunc(incomingClock.inGameTime);
    const [outgoingPresence, incomingPresence] = await Promise.all([
      outgoing ? this.presenceRepository.getOpenInterval(outgoing.id) : null,
      outgoing?.id === incoming.id ? null : this.presenceRepository.getOpenInterval(incoming.id),
    ]);
    const statements = [];

    if (outgoingPresence) {
      const presenceEndIGT = Math.max(outgoingPresence.startedIGT, outgoingIGT);
      statements.push({
        sql: `UPDATE semantic_presence_intervals
              SET ended_igt=?,exited_at=?,active_elapsed_ms=?,active_anchor_at=NULL,
                  close_reason='profile-switch',updated_at=?
              WHERE id=? AND ended_igt IS NULL`,
        bind: [presenceEndIGT, at, Math.min(
          presenceEndIGT - outgoingPresence.startedIGT,
          finalActiveElapsed(outgoingPresence, atMs),
        ), at, outgoingPresence.id],
        result: 'changes',
      });
    }
    if (incomingPresence) {
      statements.push({
        sql: `UPDATE semantic_presence_intervals
              SET ended_igt=?,exited_at=?,active_anchor_at=NULL,
                  close_reason='reconciled-after-close',updated_at=?
              WHERE id=? AND ended_igt IS NULL`,
        bind: [Math.max(incomingPresence.startedIGT, incomingIGT), at, at, incomingPresence.id],
        result: 'changes',
      });
    }
    if (outgoing && outgoing.id !== incoming.id) {
      statements.push(playerClockUpdate(outgoingClock, at));
    }
    statements.push(playerClockUpdate(incomingClock, at), {
      sql: `INSERT INTO app_state(singleton_id,active_player_id,pending_customization_json,updated_at)
            VALUES(1,?,'{}',?)
            ON CONFLICT(singleton_id) DO UPDATE SET active_player_id=excluded.active_player_id,
                                                    updated_at=excluded.updated_at`,
      bind: [incoming.id, at],
      result: 'changes',
    });
    if (commonsVisible) {
      statements.push({
        sql: `INSERT INTO semantic_presence_intervals(
                id,player_id,location,source_type,source_id,started_igt,ended_igt,
                entered_at,exited_at,active_elapsed_ms,active_anchor_at,close_reason,
                metadata_version,metadata_json,created_at,updated_at
              ) VALUES(?,?,'commons','surface',NULL,?,NULL,?,NULL,0,NULL,NULL,1,'{}',?,?)`,
        bind: [commonsIntervalId, incoming.id, incomingIGT, at, at, at],
        result: 'changes',
      });
    }
    if (outgoingPresence || incomingPresence || commonsVisible) {
      statements.push(...bumpSourceVersionStatements(PRESENCE_INVALIDATIONS, at));
    }

    const result = await this.client.executeAtomic({
      commandId: `profile-switch:${operationId}`,
      label: 'profile-switch-with-social-world-presence',
      statements,
    });
    return {
      status: 'switched',
      duplicate: result.duplicate,
      fromPlayerId: outgoing?.id || null,
      toPlayerId: incoming.id,
      outgoingIGT,
      incomingIGT,
      openedLocation: commonsVisible ? SEMANTIC_LOCATION.commons : null,
      invalidatedDomains: outgoingPresence || incomingPresence || commonsVisible
        ? PRESENCE_INVALIDATIONS
        : [],
    };
  }
}

export default SqliteSocialWorldProfileSwitchCoordinator;
