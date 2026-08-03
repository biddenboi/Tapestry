import {
  asObject,
  createImportLedgerStatements,
  deterministicRows,
  fingerprintShadowSource,
  omitKeys,
  stableJson,
  textOrNull,
} from './shadowDomainUtils.js';

const IMPORTER_VERSION = 'social-shadow-v1';
const FRIEND_KEYS = new Set(['UUID','players','requestedBy','status','createdAt','acceptedAt','inGameTimestamp','metadataVersion']);
const NOTIFICATION_KEYS = new Set(['UUID','parent','title','message','kind','createdAt','readAt','inGameTimestamp','metadataVersion','meta']);

function boundedObjectJson(value, limit = 65536) {
  const json = stableJson(asObject(value));
  return json.length <= limit ? json : '{}';
}

function extra(record, keys) {
  return omitKeys(record, keys);
}

export class SocialShadowImporter {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('SocialShadowImporter requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async import({ friendships = [], notifications = [], runId = null } = {}) {
    const source = { friendships, notifications };
    const sourceFingerprint = await fingerprintShadowSource(source);
    const prior = await this.client.query({
      sql: `SELECT run_id AS runId FROM shadow_import_runs
            WHERE domain='social' AND source_fingerprint=? AND importer_version=?`,
      bind: [sourceFingerprint, IMPORTER_VERSION], result: 'one',
    });
    if (prior) return { duplicate: true, runId: prior.runId, sourceFingerprint };

    const timestamp = this.now().toISOString();
    const diagnostics = [];
    const friendshipInput = deterministicRows(friendships, { kind: 'friendship' });
    const notificationInput = deterministicRows(notifications, { kind: 'notification' });
    diagnostics.push(...friendshipInput.conflicts, ...friendshipInput.rejected,
      ...notificationInput.conflicts, ...notificationInput.rejected);

    const playerIds = new Set((await this.client.query({ sql: 'SELECT id FROM players ORDER BY id', result: 'all' })).map((row) => String(row.id)));
    const candidates = [];
    for (const record of friendshipInput.selected) {
      const id = String(record.UUID);
      const members = [...new Set((Array.isArray(record.players) ? record.players : []).map(String).filter(Boolean))];
      if (members.length !== 2 || members.some((member) => !playerIds.has(member))) {
        diagnostics.push({ kind: 'friendship', recordId: id, reason: 'invalid-membership', members });
        continue;
      }
      const requester = textOrNull(record.requestedBy) || members[0];
      if (!members.includes(requester)) {
        diagnostics.push({ kind: 'friendship', recordId: id, reason: 'requester-not-member', requester });
        continue;
      }
      const recipient = members.find((member) => member !== requester);
      const status = record.status === 'accepted' ? 'accepted' : 'pending';
      const acceptedAt = status === 'accepted'
        ? (textOrNull(record.acceptedAt) || textOrNull(record.updatedAt) || textOrNull(record.createdAt) || timestamp)
        : null;
      const pairKey = [...members].sort().join('\u0000');
      candidates.push({ record, id, requester, recipient, status, acceptedAt, pairKey, canonical: stableJson(record) });
    }

    const selectedByPair = new Map();
    for (const candidate of candidates.sort((left, right) => (
      left.pairKey.localeCompare(right.pairKey)
      || Number(right.status === 'accepted') - Number(left.status === 'accepted')
      || left.canonical.localeCompare(right.canonical)
    ))) {
      if (!selectedByPair.has(candidate.pairKey)) selectedByPair.set(candidate.pairKey, candidate);
      else diagnostics.push({ kind: 'friendship', recordId: candidate.id, reason: 'duplicate-player-pair', selectedId: selectedByPair.get(candidate.pairKey).id });
    }

    const statements = [];
    const importedFriendIds = new Set();
    for (const candidate of [...selectedByPair.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const { record, id, requester, recipient, status, acceptedAt } = candidate;
      importedFriendIds.add(id);
      statements.push({
        sql: `INSERT INTO friendships(
                id,requester_player_id,recipient_player_id,status,created_at,accepted_at,in_game_timestamp,metadata_version,metadata_json
              ) VALUES(?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                requester_player_id=excluded.requester_player_id,recipient_player_id=excluded.recipient_player_id,
                status=excluded.status,created_at=excluded.created_at,accepted_at=excluded.accepted_at,
                in_game_timestamp=excluded.in_game_timestamp,metadata_version=excluded.metadata_version,
                metadata_json=excluded.metadata_json`,
        bind: [id, requester, recipient, status, textOrNull(record.createdAt) || timestamp, acceptedAt,
          Number.isFinite(Number(record.inGameTimestamp)) ? Math.trunc(Number(record.inGameTimestamp)) : null,
          Math.max(1, Math.trunc(Number(record.metadataVersion) || 1)),
          boundedObjectJson(extra(record, FRIEND_KEYS))],
        result: 'changes',
      });
    }

    let importedNotifications = 0;
    for (const record of notificationInput.selected) {
      const id = String(record.UUID);
      const recipient = textOrNull(record.parent);
      if (!recipient || !playerIds.has(recipient)) {
        diagnostics.push({ kind: 'notification', recordId: id, reason: 'unknown-recipient', playerId: recipient });
        continue;
      }
      const meta = asObject(record.meta);
      if (record.kind === 'friend_request' && (!textOrNull(meta.friendshipUUID) || !textOrNull(meta.requesterUUID))) {
        diagnostics.push({ kind: 'notification', recordId: id, reason: 'invalid-friend-request-metadata' });
        continue;
      }
      if (meta.friendshipUUID && !importedFriendIds.has(String(meta.friendshipUUID))) {
        diagnostics.push({ kind: 'notification', recordId: id, reason: 'unknown-friendship-reference', friendshipId: meta.friendshipUUID });
      }
      const mergedMeta = { ...extra(record, NOTIFICATION_KEYS), ...meta };
      statements.push({
        sql: `INSERT INTO notifications(
                id,recipient_player_id,title,message,kind,created_at,read_at,in_game_timestamp,metadata_version,metadata_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                recipient_player_id=excluded.recipient_player_id,title=excluded.title,message=excluded.message,
                kind=excluded.kind,created_at=excluded.created_at,read_at=excluded.read_at,
                in_game_timestamp=excluded.in_game_timestamp,metadata_version=excluded.metadata_version,
                metadata_json=excluded.metadata_json`,
        bind: [id, recipient, String(record.title || 'Notification').slice(0, 512), String(record.message || '').slice(0, 8192),
          String(record.kind || 'info').slice(0, 128), textOrNull(record.createdAt) || timestamp, textOrNull(record.readAt),
          Number.isFinite(Number(record.inGameTimestamp)) ? Math.trunc(Number(record.inGameTimestamp)) : null,
          Math.max(1, Math.trunc(Number(record.metadataVersion) || 1)), boundedObjectJson(mergedMeta)],
        result: 'changes',
      });
      importedNotifications += 1;
    }

    const counts = {
      friendships: selectedByPair.size,
      notifications: importedNotifications,
      diagnostics: diagnostics.length,
    };
    const effectiveRunId = runId || `social:${sourceFingerprint.slice(0, 24)}`;
    statements.push(...createImportLedgerStatements({
      runId: effectiveRunId, domain: 'social', sourceFingerprint, importerVersion: IMPORTER_VERSION,
      startedAt: timestamp, finishedAt: timestamp, counts, diagnostics,
    }));
    await this.client.executeAtomic({ commandId: `shadow-import:${effectiveRunId}`, label: 'social-shadow-import', statements });
    return { duplicate: false, runId: effectiveRunId, sourceFingerprint, counts, diagnostics };
  }
}

export default SocialShadowImporter;
