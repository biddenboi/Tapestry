import {
  activatePlayerIGT,
  freezePlayerIGT,
  migratePlayerIGTClock,
  PROFILE_IGT_ACTIVITY_RECOVERY_VERSION,
} from '../../../domain/time/Time.js';
import { parseJson } from './shadowDomainUtils.js';


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

export class SqliteProfileSwitchCoordinator {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client?.query || !client?.executeAtomic) {
      throw new Error('Profile switch coordination requires a SQLite client.');
    }
    this.client = client;
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
  } = {}) {
    if (!toPlayerId || !operationId) throw new Error('Profile switching requires a target and operation ID.');
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
    const statements = [];
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
    const result = await this.client.executeAtomic({
      commandId: `profile-switch:${operationId}`,
      label: 'profile-switch',
      statements,
    });
    return {
      status: 'switched',
      duplicate: result.duplicate,
      fromPlayerId: outgoing?.id || null,
      toPlayerId: incoming.id,
      outgoingIGT,
      incomingIGT,
    };
  }
}

export default SqliteProfileSwitchCoordinator;
