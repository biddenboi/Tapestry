import {
  SEMANTIC_LOCATION,
  isSemanticLocation,
} from '../../../domain/social-world/SocialWorldContracts.js';
import {
  getCurrentIGT,
  migratePlayerIGTClock,
} from '../../../domain/time/Time.js';
import { parseJson, stableJson } from './shadowDomainUtils.js';
import { bumpSourceVersionStatements } from './sourceVersionUtils.js';

export const PRESENCE_INVALIDATIONS = Object.freeze(['presence', 'socialWorld']);
export const SOCIAL_WORLD_INVALIDATIONS = Object.freeze(['socialWorld']);

const TRACKED_ACTIVE_LOCATIONS = new Set([
  SEMANTIC_LOCATION.taskSession,
  SEMANTIC_LOCATION.dojo,
]);

const CLOSE_REASONS = new Set([
  'surface-exit',
  'completed',
  'profile-switch',
  'backgrounded',
  'interrupted',
  'reconciled-after-close',
]);

const PRESENCE_COLUMNS = `
id,player_id AS playerId,location,source_type AS sourceType,source_id AS sourceId,
       started_igt AS startedIGT,ended_igt AS endedIGT,entered_at AS enteredAt,
       exited_at AS exitedAt,active_elapsed_ms AS activeElapsedMs,
       active_anchor_at AS activeAnchorAt,close_reason AS closeReason,
       metadata_version AS metadataVersion,metadata_json AS metadataJson,
       visibility_policy AS visibilityPolicy,expires_at AS expiresAt,
       created_at AS createdAt,updated_at AS updatedAt
`.trim();
const PRESENCE_SELECT = `SELECT ${PRESENCE_COLUMNS} FROM semantic_presence_intervals`;

function asIGT(value, label = 'IGT') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new TypeError(`${label} must be a non-negative number.`);
  return Math.trunc(numeric);
}

function asISO(value, fallback) {
  const date = value instanceof Date ? value : new Date(value || fallback());
  if (!Number.isFinite(date.getTime())) throw new TypeError('A valid presence timestamp is required.');
  return date.toISOString();
}

function normalizeCloseReason(value) {
  const reason = String(value || 'interrupted');
  if (!CLOSE_REASONS.has(reason)) throw new TypeError(`Unsupported presence close reason: ${reason}`);
  return reason;
}

function hydrateInterval(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    UUID: row.id,
    playerId: row.playerId,
    parent: row.playerId,
    location: row.location,
    sourceType: row.sourceType || null,
    sourceId: row.sourceId || null,
    startedIGT: Number(row.startedIGT),
    endedIGT: row.endedIGT == null ? null : Number(row.endedIGT),
    enteredAt: row.enteredAt,
    exitedAt: row.exitedAt || null,
    activeElapsedMs: Number(row.activeElapsedMs || 0),
    activeAnchorAt: row.activeAnchorAt || null,
    closeReason: row.closeReason || null,
    metadataVersion: Number(row.metadataVersion || 1),
    metadata: parseJson(row.metadataJson, {}),
    visibilityPolicy: row.visibilityPolicy || 'state-only',
    expiresAt: row.expiresAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    tracksActiveElapsed: TRACKED_ACTIVE_LOCATIONS.has(row.location),
  });
}

function activeElapsedAt(interval, atISO) {
  const stored = Math.max(0, Number(interval?.activeElapsedMs || 0));
  if (!interval?.tracksActiveElapsed || !interval.activeAnchorAt) return Math.trunc(stored);
  const anchor = new Date(interval.activeAnchorAt).getTime();
  const boundary = new Date(atISO).getTime();
  if (!Number.isFinite(anchor) || !Number.isFinite(boundary)) return Math.trunc(stored);
  return Math.trunc(stored + Math.max(0, boundary - anchor));
}

function sameSource(interval, { location, sourceType, sourceId }) {
  return interval?.location === location
    && String(interval?.sourceType || '') === String(sourceType || '')
    && String(interval?.sourceId || '') === String(sourceId || '');
}

function openDojoRollupStatement({ sessionId, playerId, intervalId, startedIGT, at }) {
  if (!sessionId) return null;
  return {
    sql: `INSERT INTO dojo_session_rollups(
            session_id,player_id,presence_interval_id,started_igt,ended_igt,focused_ms,
            points,task_count,status,boundary_claim,last_activity_at,source_version
          ) VALUES(?,?,?,?,NULL,0,0,0,'provisional','exact',?,1)
          ON CONFLICT(session_id) DO UPDATE SET
            player_id=excluded.player_id,
            presence_interval_id=excluded.presence_interval_id,
            started_igt=MIN(COALESCE(dojo_session_rollups.started_igt,excluded.started_igt),excluded.started_igt),
            ended_igt=NULL,
            status='provisional',
            boundary_claim='exact',
            last_activity_at=excluded.last_activity_at,
            source_version=dojo_session_rollups.source_version+1`,
    bind: [String(sessionId), String(playerId), String(intervalId), startedIGT, at],
    result: 'changes',
  };
}

function finalizeDojoRollupStatement(interval, { endedIGT, focusedMs, at }) {
  if (interval?.location !== SEMANTIC_LOCATION.dojo || !interval?.sourceId) return null;
  return {
    sql: `UPDATE dojo_session_rollups
          SET ended_igt=?,focused_ms=focused_ms+?,status='complete',boundary_claim='exact',
              last_activity_at=?,source_version=source_version+1
          WHERE session_id=?`,
    bind: [endedIGT, Math.max(0, Math.trunc(Number(focusedMs) || 0)), at, String(interval.sourceId)],
    result: 'changes',
  };
}

function assignmentRow(row) {
  return row ? Object.freeze({
    viewerId: row.viewerId,
    role: row.role,
    subjectId: row.subjectId,
    algorithmVersion: Number(row.algorithmVersion),
    assignedAtIGT: Number(row.assignedAtIGT),
    reviewAfterIGT: Number(row.reviewAfterIGT),
    evidence: parseJson(row.evidenceJson, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }) : null;
}

function castReviewRow(row) {
  return row ? Object.freeze({
    viewerId: row.viewerId,
    algorithmVersion: Number(row.algorithmVersion),
    reviewedAtIGT: Number(row.reviewedAtIGT),
    reviewAfterIGT: Number(row.reviewAfterIGT),
    outcome: row.outcome,
    diagnostics: parseJson(row.diagnosticsJson, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }) : null;
}

function normalizeCastAssignments(viewerId, assignments = []) {
  const normalized = assignments.map((assignment) => ({
    role: String(assignment.role),
    subjectId: String(assignment.subjectId),
    algorithmVersion: Math.max(1, Math.trunc(Number(assignment.algorithmVersion) || 1)),
    assignedAtIGT: asIGT(assignment.assignedAtIGT, 'assignedAtIGT'),
    reviewAfterIGT: asIGT(assignment.reviewAfterIGT, 'reviewAfterIGT'),
    evidence: assignment.evidence || {},
  }));
  if (normalized.length > 2
    || normalized.some((entry) => !['near-peer', 'horizon'].includes(entry.role))
    || new Set(normalized.map((entry) => entry.role)).size !== normalized.length
    || new Set(normalized.map((entry) => entry.subjectId)).size !== normalized.length
    || normalized.some((entry) => entry.subjectId === String(viewerId)
      || entry.reviewAfterIGT < entry.assignedAtIGT)) {
    throw new TypeError('Cast assignments must contain unique valid roles, subjects, and review boundaries.');
  }
  return normalized;
}

export class SqliteSocialWorldRepository {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client?.query || !client?.executeAtomic) {
      throw new Error('SqliteSocialWorldRepository requires a SQLite client.');
    }
    this.client = client;
    this.now = now;
  }

  async _wasCommitted(commandId) {
    if (!commandId) return false;
    return Number(await this.client.query({
      sql: 'SELECT COUNT(*) FROM runtime_command_receipts WHERE command_id=?',
      bind: [commandId],
      result: 'value',
    }) || 0) > 0;
  }

  async getOpenInterval(playerId) {
    if (!playerId) return null;
    return hydrateInterval(await this.client.query({
      sql: `${PRESENCE_SELECT} WHERE player_id=? AND ended_igt IS NULL LIMIT 1`,
      bind: [playerId],
      result: 'one',
    }));
  }

  async getInterval(intervalId) {
    if (!intervalId) return null;
    return hydrateInterval(await this.client.query({
      sql: `${PRESENCE_SELECT} WHERE id=?`,
      bind: [intervalId],
      result: 'one',
    }));
  }

  async listIntervalsForPlayer(playerId, { throughIGT = Infinity, limit = 64 } = {}) {
    if (!playerId) return [];
    const clauses = ['player_id=?'];
    const bind = [playerId];
    if (Number.isFinite(Number(throughIGT))) {
      clauses.push('started_igt<=?');
      bind.push(asIGT(throughIGT, 'throughIGT'));
    }
    bind.push(Math.max(1, Math.min(200, Math.trunc(Number(limit) || 64))));
    const rows = await this.client.query({
      sql: `${PRESENCE_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY started_igt DESC,id LIMIT ?`,
      bind,
      result: 'all',
    });
    return rows.map(hydrateInterval);
  }

  async listIntervalsForPlayers(playerIds, { throughIGT, limitPerPlayer = 64 } = {}) {
    const ids = [...new Set((Array.isArray(playerIds) ? playerIds : [playerIds])
      .filter(Boolean)
      .map(String))];
    if (!ids.length) return [];
    const cursor = asIGT(throughIGT, 'throughIGT');
    const limit = Math.max(1, Math.min(200, Math.trunc(Number(limitPerPlayer) || 64)));
    const placeholders = ids.map(() => '?').join(',');
    const rows = await this.client.query({
      sql: `SELECT * FROM (
              SELECT ${PRESENCE_COLUMNS},
                     ROW_NUMBER() OVER (
                       PARTITION BY player_id ORDER BY started_igt DESC,id
                     ) AS presenceRank
              FROM semantic_presence_intervals
              WHERE player_id IN (${placeholders}) AND started_igt<=?
            ) bounded_presence
            WHERE presenceRank<=?
            ORDER BY playerId,startedIGT DESC,id`,
      bind: [...ids, cursor, limit],
      result: 'all',
    });
    return rows.map(hydrateInterval);
  }

  async listIntervalsAtIGT(playerIds, viewerIGT) {
    const ids = [...new Set((Array.isArray(playerIds) ? playerIds : [playerIds])
      .filter(Boolean)
      .map(String))];
    if (!ids.length) return [];
    const cursor = asIGT(viewerIGT, 'viewerIGT');
    const placeholders = ids.map(() => '?').join(',');
    const rows = await this.client.query({
      sql: `${PRESENCE_SELECT}
            WHERE player_id IN (${placeholders})
              AND started_igt<=?
              AND (ended_igt IS NULL OR ended_igt>?)
            ORDER BY player_id,started_igt DESC,id`,
      bind: [...ids, cursor, cursor],
      result: 'all',
    });
    const now = Date.now();
    return rows.map(hydrateInterval).filter((interval) => (
      interval.endedIGT != null
      || !interval.expiresAt
      || new Date(interval.expiresAt).getTime() > now
    ));
  }

  async transitionPresence({
    intervalId,
    playerId,
    location,
    startedIGT,
    enteredAt = this.now(),
    sourceType = null,
    sourceId = null,
    closeReason = 'interrupted',
    metadataVersion = 1,
    metadata = {},
    visibilityPolicy = 'state-only',
    expiresAt = null,
    commandId,
  } = {}) {
    if (!intervalId || !playerId || !commandId) {
      throw new Error('Presence transition requires interval, player, and command IDs.');
    }
    if (!isSemanticLocation(location)) throw new TypeError(`Unsupported semantic location: ${location}`);
    const receiptId = `presence-transition:${commandId}`;
    if (await this._wasCommitted(receiptId)) {
      return {
        interval: await this.getOpenInterval(playerId),
        duplicate: true,
        invalidatedDomains: PRESENCE_INVALIDATIONS,
      };
    }
    const current = await this.getOpenInterval(playerId);
    if (sameSource(current, { location, sourceType, sourceId })) {
      const at = asISO(enteredAt, this.now);
      const result = await this.client.executeAtomic({
        commandId: receiptId,
        label: 'social-world-presence-renew',
        statements: [{
          sql: `UPDATE semantic_presence_intervals
                SET visibility_policy=?,expires_at=?,updated_at=?
                WHERE id=? AND ended_igt IS NULL`,
          bind: [
            ['state-only', 'goal', 'task', 'private'].includes(visibilityPolicy)
              ? visibilityPolicy
              : 'state-only',
            expiresAt ? asISO(expiresAt, this.now) : null,
            at,
            current.id,
          ],
          result: 'changes',
        }, ...bumpSourceVersionStatements(PRESENCE_INVALIDATIONS, at)],
      });
      return {
        interval: await this.getOpenInterval(playerId),
        previous: null,
        duplicate: result.duplicate,
        renewed: true,
        invalidatedDomains: PRESENCE_INVALIDATIONS,
      };
    }

    const at = asISO(enteredAt, this.now);
    const boundary = asIGT(startedIGT, 'startedIGT');
    const statements = [];
    let dojoRollupChanged = false;
    if (current) {
      const endedIGT = Math.max(current.startedIGT, boundary);
      const finalActiveElapsed = Math.min(
        endedIGT - current.startedIGT,
        activeElapsedAt(current, at),
      );
      statements.push({
        sql: `UPDATE semantic_presence_intervals
              SET ended_igt=?,exited_at=?,active_elapsed_ms=?,active_anchor_at=NULL,
                  close_reason=?,updated_at=?
              WHERE id=? AND ended_igt IS NULL`,
        bind: [endedIGT, at, finalActiveElapsed, normalizeCloseReason(closeReason), at, current.id],
        result: 'changes',
      });
      const finalizeDojo = finalizeDojoRollupStatement(current, {
        endedIGT,
        focusedMs: finalActiveElapsed,
        at,
      });
      if (finalizeDojo) {
        statements.push(finalizeDojo);
        dojoRollupChanged = true;
      }
    }
    const tracksActiveElapsed = TRACKED_ACTIVE_LOCATIONS.has(location);
    statements.push({
      sql: `INSERT INTO semantic_presence_intervals(
              id,player_id,location,source_type,source_id,started_igt,ended_igt,
              entered_at,exited_at,active_elapsed_ms,active_anchor_at,close_reason,
              metadata_version,metadata_json,visibility_policy,expires_at,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,NULL,?,NULL,0,?,NULL,?,?,?,?,?,?)`,
      bind: [
        intervalId,
        playerId,
        location,
        sourceType ? String(sourceType) : null,
        sourceId ? String(sourceId) : null,
        boundary,
        at,
        tracksActiveElapsed ? at : null,
        Math.max(1, Math.trunc(Number(metadataVersion) || 1)),
        stableJson(metadata),
        ['state-only', 'goal', 'task', 'private'].includes(visibilityPolicy)
          ? visibilityPolicy
          : 'state-only',
        expiresAt ? asISO(expiresAt, this.now) : null,
        at,
        at,
      ],
      result: 'changes',
    });
    if (location === SEMANTIC_LOCATION.dojo && sourceId) {
      statements.push(openDojoRollupStatement({
        sessionId: sourceId,
        playerId,
        intervalId,
        startedIGT: boundary,
        at,
      }));
      dojoRollupChanged = true;
    }
    statements.push(...bumpSourceVersionStatements(PRESENCE_INVALIDATIONS, at));
    if (dojoRollupChanged) statements.push(...bumpSourceVersionStatements(['dojoStandings'], at));

    const result = await this.client.executeAtomic({
      commandId: receiptId,
      label: 'social-world-presence-transition',
      statements,
    });
    return {
      interval: await this.getOpenInterval(playerId),
      previous: current,
      duplicate: result.duplicate,
      invalidatedDomains: PRESENCE_INVALIDATIONS,
    };
  }

  async pausePresence({ playerId, pausedAt = this.now(), pausedIGT, commandId } = {}) {
    if (!playerId || !commandId) throw new Error('Pausing presence requires player and command IDs.');
    const pauseBoundary = asIGT(pausedIGT, 'pausedIGT');
    const receiptId = `presence-pause:${commandId}`;
    if (await this._wasCommitted(receiptId)) {
      return { interval: await this.getOpenInterval(playerId), duplicate: true, invalidatedDomains: PRESENCE_INVALIDATIONS };
    }
    const current = await this.getOpenInterval(playerId);
    if (!current || !current.tracksActiveElapsed || !current.activeAnchorAt) {
      return { interval: current, duplicate: false, unchanged: true, invalidatedDomains: [] };
    }
    const at = asISO(pausedAt, this.now);
    const result = await this.client.executeAtomic({
      commandId: receiptId,
      label: 'social-world-presence-pause',
      statements: [{
        sql: `UPDATE semantic_presence_intervals
              SET active_elapsed_ms=?,active_anchor_at=NULL,updated_at=?
              WHERE id=? AND ended_igt IS NULL AND active_anchor_at IS NOT NULL`,
        bind: [Math.min(
          Math.max(0, pauseBoundary - current.startedIGT),
          activeElapsedAt(current, at),
        ), at, current.id],
        result: 'changes',
      }, ...bumpSourceVersionStatements(PRESENCE_INVALIDATIONS, at)],
    });
    return { interval: await this.getOpenInterval(playerId), duplicate: result.duplicate, invalidatedDomains: PRESENCE_INVALIDATIONS };
  }

  async resumePresence({ playerId, resumedAt = this.now(), resumedIGT, commandId } = {}) {
    if (!playerId || !commandId) throw new Error('Resuming presence requires player and command IDs.');
    asIGT(resumedIGT, 'resumedIGT');
    const receiptId = `presence-resume:${commandId}`;
    if (await this._wasCommitted(receiptId)) {
      return { interval: await this.getOpenInterval(playerId), duplicate: true, invalidatedDomains: PRESENCE_INVALIDATIONS };
    }
    const current = await this.getOpenInterval(playerId);
    if (!current || !current.tracksActiveElapsed || current.activeAnchorAt) {
      return { interval: current, duplicate: false, unchanged: true, invalidatedDomains: [] };
    }
    const at = asISO(resumedAt, this.now);
    const result = await this.client.executeAtomic({
      commandId: receiptId,
      label: 'social-world-presence-resume',
      statements: [{
        sql: `UPDATE semantic_presence_intervals SET active_anchor_at=?,updated_at=?
              WHERE id=? AND ended_igt IS NULL AND active_anchor_at IS NULL`,
        bind: [at, at, current.id],
        result: 'changes',
      }, ...bumpSourceVersionStatements(PRESENCE_INVALIDATIONS, at)],
    });
    return { interval: await this.getOpenInterval(playerId), duplicate: result.duplicate, invalidatedDomains: PRESENCE_INVALIDATIONS };
  }

  async closePresence({
    playerId,
    endedIGT,
    exitedAt = this.now(),
    closeReason = 'interrupted',
    expectedLocation = null,
    commandId,
  } = {}) {
    if (!playerId || !commandId) throw new Error('Closing presence requires player and command IDs.');
    const receiptId = `presence-close:${commandId}`;
    if (await this._wasCommitted(receiptId)) {
      return { interval: null, duplicate: true, invalidatedDomains: PRESENCE_INVALIDATIONS };
    }
    const current = await this.getOpenInterval(playerId);
    if (!current || (expectedLocation && current.location !== expectedLocation)) {
      return { interval: current, duplicate: false, unchanged: true, invalidatedDomains: [] };
    }
    const at = asISO(exitedAt, this.now);
    const boundary = Math.max(current.startedIGT, asIGT(endedIGT, 'endedIGT'));
    const finalActiveElapsed = Math.min(
      boundary - current.startedIGT,
      activeElapsedAt(current, at),
    );
    const statements = [{
      sql: `UPDATE semantic_presence_intervals
            SET ended_igt=?,exited_at=?,active_elapsed_ms=?,active_anchor_at=NULL,
                close_reason=?,updated_at=?
            WHERE id=? AND ended_igt IS NULL`,
      bind: [boundary, at, finalActiveElapsed, normalizeCloseReason(closeReason), at, current.id],
      result: 'changes',
    }];
    const finalizeDojo = finalizeDojoRollupStatement(current, {
      endedIGT: boundary,
      focusedMs: finalActiveElapsed,
      at,
    });
    if (finalizeDojo) statements.push(finalizeDojo);
    statements.push(...bumpSourceVersionStatements(PRESENCE_INVALIDATIONS, at));
    if (finalizeDojo) statements.push(...bumpSourceVersionStatements(['dojoStandings'], at));
    const result = await this.client.executeAtomic({
      commandId: receiptId,
      label: 'social-world-presence-close',
      statements,
    });
    return {
      interval: await this.getInterval(current.id),
      duplicate: result.duplicate,
      invalidatedDomains: PRESENCE_INVALIDATIONS,
    };
  }

  async reconcileOpenIntervals({ commandId, reconciledAt = this.now() } = {}) {
    if (!commandId) throw new Error('Presence reconciliation requires a command ID.');
    const receiptId = `presence-reconcile:${commandId}`;
    if (await this._wasCommitted(receiptId)) {
      return { closed: [], duplicate: true, invalidatedDomains: PRESENCE_INVALIDATIONS };
    }
    const rows = await this.client.query({
      sql: `SELECT spi.id,spi.player_id AS playerId,spi.location,spi.source_id AS sourceId,
                   spi.started_igt AS startedIGT,p.created_at AS playerCreatedAt,
                   p.updated_at AS playerUpdatedAt,p.in_game_time AS playerInGameTime,
                   p.extra_json AS playerExtraJson,
                   CASE WHEN app.active_player_id=p.id THEN 1 ELSE 0 END AS playerActive,
                   spi.active_elapsed_ms AS activeElapsedMs,spi.active_anchor_at AS activeAnchorAt,
                   m.status AS sourceMatchStatus
            FROM semantic_presence_intervals spi
            JOIN players p ON p.id=spi.player_id
            LEFT JOIN app_state app ON app.singleton_id=1
            LEFT JOIN matches m ON spi.location='match-arena' AND m.id=spi.source_id
            WHERE spi.ended_igt IS NULL
            ORDER BY spi.player_id,spi.started_igt`,
      result: 'all',
    });
    const candidates = rows.filter((row) => !(
      row.location === SEMANTIC_LOCATION.matchArena && row.sourceMatchStatus === 'active'
    ));
    if (!candidates.length) return { closed: [], duplicate: false, invalidatedDomains: [] };
    const at = asISO(reconciledAt, this.now);
    const atMs = new Date(at).getTime();
    let dojoRollupChanged = false;
    const statements = candidates.flatMap((row) => {
      const player = migratePlayerIGTClock({
        ...parseJson(row.playerExtraJson, {}),
        inGameTime: row.playerInGameTime,
        createdAt: row.playerCreatedAt,
        updatedAt: row.playerUpdatedAt,
      }, {
        active: Boolean(row.playerActive),
        nowMs: atMs,
      });
      const endedIGT = Math.max(
        Number(row.startedIGT),
        getCurrentIGT(player, atMs),
      );
      const focusedMs = Math.min(
        endedIGT - Number(row.startedIGT),
        activeElapsedAt({ ...row, tracksActiveElapsed: TRACKED_ACTIVE_LOCATIONS.has(row.location) }, at),
      );
      const next = [{
        sql: `UPDATE semantic_presence_intervals
              SET ended_igt=?,exited_at=?,active_elapsed_ms=?,active_anchor_at=NULL,
                  close_reason='reconciled-after-close',updated_at=?
              WHERE id=? AND ended_igt IS NULL`,
        bind: [endedIGT, at, focusedMs, at, row.id],
        result: 'changes',
      }];
      const finalizeDojo = finalizeDojoRollupStatement(row, { endedIGT, focusedMs, at });
      if (finalizeDojo) {
        next.push(finalizeDojo);
        dojoRollupChanged = true;
      }
      return next;
    });
    statements.push(...bumpSourceVersionStatements(PRESENCE_INVALIDATIONS, at));
    if (dojoRollupChanged) statements.push(...bumpSourceVersionStatements(['dojoStandings'], at));
    const result = await this.client.executeAtomic({
      commandId: receiptId,
      label: 'social-world-presence-reconcile',
      statements,
    });
    return {
      closed: await Promise.all(candidates.map((row) => this.getInterval(row.id))),
      duplicate: result.duplicate,
      invalidatedDomains: PRESENCE_INVALIDATIONS,
    };
  }

  async getCastAssignments(viewerId) {
    if (!viewerId) return [];
    const rows = await this.client.query({
      sql: `SELECT viewer_player_id AS viewerId,role,subject_player_id AS subjectId,
                   algorithm_version AS algorithmVersion,assigned_at_igt AS assignedAtIGT,
                   review_after_igt AS reviewAfterIGT,evidence_json AS evidenceJson,
                   created_at AS createdAt,updated_at AS updatedAt
            FROM social_cast_assignments WHERE viewer_player_id=?
            ORDER BY CASE role WHEN 'near-peer' THEN 0 ELSE 1 END`,
      bind: [viewerId],
      result: 'all',
    });
    return rows.map(assignmentRow);
  }

  async getCastReview(viewerId) {
    if (!viewerId) return null;
    return castReviewRow(await this.client.query({
      sql: `SELECT viewer_player_id AS viewerId,algorithm_version AS algorithmVersion,
                   reviewed_at_igt AS reviewedAtIGT,review_after_igt AS reviewAfterIGT,
                   outcome,diagnostics_json AS diagnosticsJson,
                   created_at AS createdAt,updated_at AS updatedAt
            FROM social_cast_reviews WHERE viewer_player_id=?`,
      bind: [viewerId],
      result: 'one',
    }));
  }

  async getCastState(viewerId) {
    const [assignments, review] = await Promise.all([
      this.getCastAssignments(viewerId),
      this.getCastReview(viewerId),
    ]);
    return Object.freeze({ assignments: Object.freeze(assignments), review });
  }

  async clearCastStateForCursorRecovery({ viewerId, recoveredCursor } = {}) {
    if (!viewerId || !Number.isFinite(Number(recoveredCursor))) {
      throw new TypeError('Cursor-recovery cast invalidation requires a viewer and cursor.');
    }
    const cursor = Math.max(0, Math.trunc(Number(recoveredCursor)));
    const result = await this.client.executeAtomic({
      commandId: `social-cast-cursor-recovery:${viewerId}:${cursor}`,
      label: 'social-world-cast-cursor-recovery',
      statements: [
        {
          sql: 'DELETE FROM social_cast_assignments WHERE viewer_player_id=?',
          bind: [viewerId],
          result: 'changes',
        },
        {
          sql: 'DELETE FROM social_cast_reviews WHERE viewer_player_id=?',
          bind: [viewerId],
          result: 'changes',
        },
        ...bumpSourceVersionStatements(SOCIAL_WORLD_INVALIDATIONS, asISO(this.now(), this.now)),
      ],
    });
    return {
      cleared: true,
      recoveredCursor: cursor,
      duplicate: result.duplicate,
      invalidatedDomains: SOCIAL_WORLD_INVALIDATIONS,
    };
  }

  async replaceCastState({
    viewerId,
    assignments = [],
    review,
    commandId,
    committedAt = this.now(),
  } = {}) {
    if (!viewerId || !review || !commandId) {
      throw new Error('Replacing cast state requires viewer, review, and command IDs.');
    }
    const normalized = normalizeCastAssignments(viewerId, assignments);
    const algorithmVersion = Math.max(1, Math.trunc(Number(review.algorithmVersion) || 1));
    const reviewedAtIGT = asIGT(review.reviewedAtIGT, 'reviewedAtIGT');
    const reviewAfterIGT = asIGT(review.reviewAfterIGT, 'reviewAfterIGT');
    const outcome = String(review.outcome || 'scheduled');
    if (review?.diagnostics?.sourceReadiness !== 'complete') {
      const error = new Error('Cast reviews require complete source readiness.');
      error.code = 'social-cast-source-not-ready';
      throw error;
    }
    if (reviewAfterIGT < reviewedAtIGT
      || !['initial', 'scheduled', 'role-invalidation', 'algorithm-upgrade'].includes(outcome)
      || normalized.some((assignment) => assignment.algorithmVersion !== algorithmVersion
        || assignment.reviewAfterIGT !== reviewAfterIGT)) {
      throw new TypeError('Cast review and assignments must share a valid algorithm and review boundary.');
    }
    const receiptId = `social-cast-state:${commandId}`;
    if (await this._wasCommitted(receiptId)) {
      return { ...(await this.getCastState(viewerId)), duplicate: true, invalidatedDomains: SOCIAL_WORLD_INVALIDATIONS };
    }
    const at = asISO(committedAt, this.now);
    const existing = await this.getCastReview(viewerId);
    const result = await this.client.executeAtomic({
      commandId: receiptId,
      label: 'social-world-cast-state-replace',
      statements: [
        { sql: 'DELETE FROM social_cast_assignments WHERE viewer_player_id=?', bind: [viewerId], result: 'changes' },
        ...normalized.map((entry) => ({
          sql: `INSERT INTO social_cast_assignments(
                  viewer_player_id,role,subject_player_id,algorithm_version,
                  assigned_at_igt,review_after_igt,evidence_json,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?)`,
          bind: [viewerId, entry.role, entry.subjectId, entry.algorithmVersion,
            entry.assignedAtIGT, entry.reviewAfterIGT, stableJson(entry.evidence), at, at],
          result: 'changes',
        })),
        {
          sql: `INSERT INTO social_cast_reviews(
                  viewer_player_id,algorithm_version,reviewed_at_igt,review_after_igt,
                  outcome,diagnostics_json,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?)
                ON CONFLICT(viewer_player_id) DO UPDATE SET
                  algorithm_version=excluded.algorithm_version,
                  reviewed_at_igt=excluded.reviewed_at_igt,
                  review_after_igt=excluded.review_after_igt,
                  outcome=excluded.outcome,
                  diagnostics_json=excluded.diagnostics_json,
                  updated_at=excluded.updated_at`,
          bind: [viewerId, algorithmVersion, reviewedAtIGT, reviewAfterIGT, outcome,
            stableJson(review.diagnostics || {}), existing?.createdAt || at, at],
          result: 'changes',
        },
        ...bumpSourceVersionStatements(SOCIAL_WORLD_INVALIDATIONS, at),
      ],
    });
    return {
      ...(await this.getCastState(viewerId)),
      duplicate: result.duplicate,
      invalidatedDomains: SOCIAL_WORLD_INVALIDATIONS,
    };
  }

  async replaceCastAssignments({ viewerId, assignments = [], commandId, assignedAt = this.now() } = {}) {
    if (!viewerId || !commandId) throw new Error('Replacing cast assignments requires viewer and command IDs.');
    const normalized = normalizeCastAssignments(viewerId, assignments);
    const at = asISO(assignedAt, this.now);
    const result = await this.client.executeAtomic({
      commandId: `social-cast-replace:${commandId}`,
      label: 'social-world-cast-replace',
      statements: [
        { sql: 'DELETE FROM social_cast_assignments WHERE viewer_player_id=?', bind: [viewerId], result: 'changes' },
        ...normalized.map((entry) => ({
          sql: `INSERT INTO social_cast_assignments(
                  viewer_player_id,role,subject_player_id,algorithm_version,
                  assigned_at_igt,review_after_igt,evidence_json,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?)`,
          bind: [viewerId, entry.role, entry.subjectId, entry.algorithmVersion,
            entry.assignedAtIGT, entry.reviewAfterIGT, stableJson(entry.evidence), at, at],
          result: 'changes',
        })),
        ...bumpSourceVersionStatements(SOCIAL_WORLD_INVALIDATIONS, at),
      ],
    });
    return {
      assignments: await this.getCastAssignments(viewerId),
      duplicate: result.duplicate,
      invalidatedDomains: SOCIAL_WORLD_INVALIDATIONS,
    };
  }
}

export default SqliteSocialWorldRepository;
