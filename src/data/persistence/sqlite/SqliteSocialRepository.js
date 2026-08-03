import { parseJson, stableJson } from './shadowDomainUtils.js';
import { bumpSourceVersionStatements, readSourceVersions } from './sourceVersionUtils.js';

const SOCIAL_INVALIDATIONS = Object.freeze(['social', 'socialWorld', 'achievements', 'profileSummaries']);
const INBOX_INVALIDATIONS = Object.freeze(['social']);

function timestamp(value, fallback) {
  const date = value instanceof Date ? value : new Date(value || fallback());
  if (!Number.isFinite(date.getTime())) throw new TypeError('A valid timestamp is required.');
  return date.toISOString();
}

function hydrateFriendship(row) {
  if (!row) return null;
  return {
    ...parseJson(row.metadataJson, {}),
    UUID: row.id,
    players: [row.requesterPlayerId, row.recipientPlayerId],
    requestedBy: row.requesterPlayerId,
    status: row.status,
    createdAt: row.createdAt,
    acceptedAt: row.acceptedAt,
    inGameTimestamp: row.inGameTimestamp == null ? undefined : Number(row.inGameTimestamp),
    metadataVersion: Number(row.metadataVersion),
  };
}

function hydrateNotification(row) {
  if (!row) return null;
  return {
    UUID: row.id,
    parent: row.recipientPlayerId,
    title: row.title,
    message: row.message,
    kind: row.kind,
    createdAt: row.createdAt,
    readAt: row.readAt,
    inGameTimestamp: row.inGameTimestamp == null ? undefined : Number(row.inGameTimestamp),
    metadataVersion: Number(row.metadataVersion),
    meta: parseJson(row.metadataJson, {}),
  };
}

const FRIENDSHIP_SELECT = `
SELECT id,requester_player_id AS requesterPlayerId,recipient_player_id AS recipientPlayerId,
       status,created_at AS createdAt,accepted_at AS acceptedAt,in_game_timestamp AS inGameTimestamp,
       metadata_version AS metadataVersion,metadata_json AS metadataJson
FROM friendships
`.trim();

const NOTIFICATION_SELECT = `
SELECT id,recipient_player_id AS recipientPlayerId,title,message,kind,created_at AS createdAt,
       read_at AS readAt,in_game_timestamp AS inGameTimestamp,metadata_version AS metadataVersion,
       metadata_json AS metadataJson
FROM notifications
`.trim();

export class SqliteSocialRepository {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('SqliteSocialRepository requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async getFriendship(friendshipId) {
    return hydrateFriendship(await this.client.query({
      sql: `${FRIENDSHIP_SELECT} WHERE id=?`, bind: [friendshipId], result: 'one',
    }));
  }

  async listFriendshipsForPlayer(playerId, { status = null, viewerIGT = Infinity } = {}) {
    const clauses = ['EXISTS(SELECT 1 FROM friendship_members fm WHERE fm.friendship_id=friendships.id AND fm.player_id=?)'];
    const bind = [playerId];
    if (status) { clauses.push('status=?'); bind.push(String(status)); }
    if (Number.isFinite(Number(viewerIGT))) {
      clauses.push('(in_game_timestamp IS NULL OR in_game_timestamp<=?)');
      bind.push(Math.trunc(Number(viewerIGT)));
    }
    const rows = await this.client.query({
      sql: `${FRIENDSHIP_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY created_at,id`, bind, result: 'all',
    });
    return rows.map(hydrateFriendship);
  }

  async requestFriendship({
    friendshipId,
    requesterId,
    recipientId,
    notificationId,
    operationId,
    createdAt = this.now(),
    inGameTimestamp = null,
    title = 'Friend Request',
    message = 'A player wants to be your friend.',
    metadata = {},
  } = {}) {
    if (!friendshipId || !requesterId || !recipientId || !notificationId || !operationId) {
      throw new Error('Friendship request requires relationship, players, notification, and operation IDs.');
    }
    if (String(requesterId) === String(recipientId)) {
      const error = new Error('A player cannot request friendship with themselves.');
      error.code = 'invalid-membership';
      throw error;
    }
    const existing = await this.client.query({
      sql: 'SELECT friendship_id AS friendshipId FROM friendship_request_commands WHERE operation_id=?',
      bind: [operationId], result: 'one',
    });
    if (existing) return { friendship: await this.getFriendship(existing.friendshipId), duplicate: true, invalidatedDomains: SOCIAL_INVALIDATIONS };
    const at = timestamp(createdAt, this.now);
    try {
      await this.client.executeAtomic({
        commandId: `friendship-request:${operationId}`,
        label: 'friendship-request-shadow',
        statements: [{
          sql: `INSERT INTO friendship_request_commands(
                  operation_id,friendship_id,requester_player_id,recipient_player_id,notification_id,
                  notification_title,notification_message,created_at,in_game_timestamp,metadata_json
                ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
          bind: [operationId, friendshipId, requesterId, recipientId, notificationId,
            String(title), String(message), at,
            Number.isFinite(Number(inGameTimestamp)) ? Math.trunc(Number(inGameTimestamp)) : null,
            stableJson(metadata)],
          result: 'changes',
        }, ...bumpSourceVersionStatements(['socialWorld'], at)],
      });
    } catch (error) {
      const messageText = String(error?.message || '');
      if (messageText.includes('friendship-already-exists') || messageText.includes('friendships_pair_unique_idx')) error.code = 'friendship-exists';
      else if (/FOREIGN KEY/.test(messageText)) error.code = 'invalid-membership';
      throw error;
    }
    return { friendship: await this.getFriendship(friendshipId), duplicate: false, invalidatedDomains: SOCIAL_INVALIDATIONS };
  }

  async acceptFriendship({
    friendshipId,
    accepterId,
    notificationId,
    operationId,
    acceptedAt = this.now(),
    inGameTimestamp = null,
    title = 'Friend Request Accepted',
    message = 'Your friend request was accepted.',
    metadata = {},
  } = {}) {
    if (!friendshipId || !accepterId || !notificationId || !operationId) {
      throw new Error('Friendship acceptance requires relationship, accepter, notification, and operation IDs.');
    }
    const existing = await this.client.query({
      sql: 'SELECT friendship_id AS friendshipId FROM friendship_accept_commands WHERE operation_id=?',
      bind: [operationId], result: 'one',
    });
    if (existing) return { friendship: await this.getFriendship(existing.friendshipId), duplicate: true, invalidatedDomains: SOCIAL_INVALIDATIONS };
    const at = timestamp(acceptedAt, this.now);
    try {
      await this.client.executeAtomic({
        commandId: `friendship-accept:${operationId}`,
        label: 'friendship-accept-shadow',
        statements: [{
          sql: `INSERT INTO friendship_accept_commands(
                  operation_id,friendship_id,accepter_player_id,notification_id,
                  notification_title,notification_message,accepted_at,in_game_timestamp,metadata_json
                ) VALUES(?,?,?,?,?,?,?,?,?)`,
          bind: [operationId, friendshipId, accepterId, notificationId, String(title), String(message), at,
            Number.isFinite(Number(inGameTimestamp)) ? Math.trunc(Number(inGameTimestamp)) : null,
            stableJson(metadata)],
          result: 'changes',
        }, ...bumpSourceVersionStatements(['socialWorld'], at)],
      });
    } catch (error) {
      const messageText = String(error?.message || '');
      if (messageText.includes('friendship-not-acceptable')) error.code = 'not-acceptable';
      else if (messageText.includes('friend-cap-reached')) error.code = 'friend-cap-reached';
      throw error;
    }
    return { friendship: await this.getFriendship(friendshipId), duplicate: false, invalidatedDomains: SOCIAL_INVALIDATIONS };
  }

  async closeFriendship({ friendshipId, actorId, operationId, closedAt = this.now() } = {}) {
    if (!friendshipId || !actorId || !operationId) throw new Error('Closing a friendship requires relationship, actor, and operation IDs.');
    const existing = await this.client.query({
      sql: 'SELECT friendship_id AS friendshipId FROM friendship_close_commands WHERE operation_id=?',
      bind: [operationId], result: 'one',
    });
    if (existing) return { friendshipId: existing.friendshipId, duplicate: true, invalidatedDomains: SOCIAL_INVALIDATIONS };
    const at = timestamp(closedAt, this.now);
    try {
      await this.client.executeAtomic({
        commandId: `friendship-close:${operationId}`,
        label: 'friendship-close-shadow',
        statements: [{
          sql: 'INSERT INTO friendship_close_commands(operation_id,friendship_id,actor_player_id,closed_at) VALUES(?,?,?,?)',
          bind: [operationId, friendshipId, actorId, at], result: 'changes',
        }, ...bumpSourceVersionStatements(['socialWorld'], at)],
      });
    } catch (error) {
      if (String(error?.message || '').includes('friendship-not-closable')) error.code = 'not-closable';
      throw error;
    }
    return { friendshipId, duplicate: false, invalidatedDomains: SOCIAL_INVALIDATIONS };
  }

  async createNotification({
    id,
    recipientId,
    title,
    message = '',
    kind = 'info',
    createdAt = this.now(),
    readAt = null,
    inGameTimestamp = null,
    metadataVersion = 1,
    metadata = {},
    operationId,
  } = {}) {
    if (!id || !recipientId || !title || !operationId) throw new Error('Notification requires id, recipient, title, and operation ID.');
    const at = timestamp(createdAt, this.now);
    const statements = [{
      sql: `INSERT INTO notifications(
              id,recipient_player_id,title,message,kind,created_at,read_at,in_game_timestamp,metadata_version,metadata_json
            ) VALUES(?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO NOTHING`,
      bind: [id, recipientId, String(title), String(message), String(kind), at,
        readAt ? timestamp(readAt, this.now) : null,
        Number.isFinite(Number(inGameTimestamp)) ? Math.trunc(Number(inGameTimestamp)) : null,
        Math.max(1, Math.trunc(Number(metadataVersion) || 1)), stableJson(metadata)],
      result: 'changes',
    }, ...bumpSourceVersionStatements(INBOX_INVALIDATIONS, at)];
    const result = await this.client.executeAtomic({
      commandId: `notification-create:${operationId}`,
      label: 'notification-create-shadow',
      statements,
    });
    return { notification: await this.getNotification(id), duplicate: result.duplicate, invalidatedDomains: INBOX_INVALIDATIONS };
  }

  async getNotification(notificationId) {
    return hydrateNotification(await this.client.query({
      sql: `${NOTIFICATION_SELECT} WHERE id=?`, bind: [notificationId], result: 'one',
    }));
  }

  async listNotificationsForPlayer(playerId, {
    viewerIGT = Infinity,
    unreadOnly = false,
    kind = null,
    newestFirst = false,
  } = {}) {
    const clauses = ['recipient_player_id=?'];
    const bind = [playerId];
    if (Number.isFinite(Number(viewerIGT))) {
      clauses.push('(in_game_timestamp IS NULL OR in_game_timestamp<=?)');
      bind.push(Math.trunc(Number(viewerIGT)));
    }
    if (unreadOnly) clauses.push('read_at IS NULL');
    if (kind) { clauses.push('kind=?'); bind.push(String(kind)); }
    const rows = await this.client.query({
      sql: `${NOTIFICATION_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY created_at ${newestFirst ? 'DESC' : 'ASC'},id ${newestFirst ? 'DESC' : 'ASC'}`,
      bind, result: 'all',
    });
    return rows.map(hydrateNotification);
  }

  async markNotificationRead(notificationId, { operationId, readAt = this.now() } = {}) {
    if (!notificationId || !operationId) throw new Error('Marking a notification read requires notification and operation IDs.');
    const at = timestamp(readAt, this.now);
    const result = await this.client.executeAtomic({
      commandId: `notification-read:${operationId}`,
      label: 'notification-read-shadow',
      statements: [{
        sql: 'UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=?',
        bind: [at, notificationId], result: 'changes',
      }, ...bumpSourceVersionStatements(INBOX_INVALIDATIONS, at)],
    });
    return { notification: await this.getNotification(notificationId), duplicate: result.duplicate, invalidatedDomains: INBOX_INVALIDATIONS };
  }

  async getUnreadFriendRequestCount(playerId, { viewerIGT = Infinity } = {}) {
    const bind = [playerId];
    let delivery = '';
    if (Number.isFinite(Number(viewerIGT))) {
      delivery = 'AND (in_game_timestamp IS NULL OR in_game_timestamp<=?)';
      bind.push(Math.trunc(Number(viewerIGT)));
    }
    return Number(await this.client.query({
      sql: `SELECT COUNT(*) FROM notifications
            WHERE recipient_player_id=? AND kind='friend_request' AND read_at IS NULL ${delivery}`,
      bind, result: 'value',
    }) || 0);
  }

  async getSourceVersions() {
    return readSourceVersions(this.client);
  }
}

export { SOCIAL_INVALIDATIONS, INBOX_INVALIDATIONS };
export default SqliteSocialRepository;
