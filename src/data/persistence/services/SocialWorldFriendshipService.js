import { STORES } from '../../../domain/constants.js';
import {
  assertFriendshipCanBeAccepted,
} from '../../../domain/social-world/FriendshipResidency.js';

const INVALIDATED_DOMAINS = Object.freeze(['social', 'socialWorld', 'achievements', 'profileSummaries']);

function uniqueRelationships(rows = []) {
  return [...new Map((rows || []).filter(Boolean).map((row) => [String(row.UUID || row.id), row])).values()];
}

export class SocialWorldFriendshipService {
  constructor({ facade = null, repository = null, now = () => new Date() } = {}) {
    if (!facade && !repository) throw new Error('SocialWorldFriendshipService requires a persistence facade or repository.');
    this.facade = facade;
    this.repository = repository;
    this.now = now;
  }

  async requestFriendship(command = {}) {
    if (this.repository) return this.repository.requestFriendship(command);
    const {
      friendshipId, requesterId, recipientId, notificationId, operationId,
      createdAt = this.now(), inGameTimestamp = null,
      title = 'Friend Request', message = 'A player wants to be your friend.', metadata = {},
    } = command;
    if (!friendshipId || !requesterId || !recipientId || !notificationId || !operationId) {
      throw new Error('Friendship request requires relationship, players, notification, and operation IDs.');
    }
    if (String(requesterId) === String(recipientId)) {
      const error = new Error('A player cannot request friendship with themselves.');
      error.code = 'invalid-membership';
      throw error;
    }
    const existing = (await this.facade.getFriendshipsForPlayer(requesterId))
      .find((row) => row.players?.includes(recipientId));
    if (existing) {
      const error = new Error('A friendship or pending request already exists for these players.');
      error.code = 'friendship-exists';
      throw error;
    }
    const at = new Date(createdAt).toISOString();
    const friendship = {
      ...metadata,
      UUID: friendshipId,
      players: [requesterId, recipientId],
      requestedBy: requesterId,
      status: 'pending',
      createdAt: at,
      inGameTimestamp,
    };
    const notification = {
      UUID: notificationId,
      parent: recipientId,
      title,
      message,
      kind: 'friend_request',
      createdAt: at,
      readAt: null,
      inGameTimestamp,
      meta: { friendshipUUID: friendshipId, requesterUUID: requesterId },
    };
    await this.facade.commitAtomicMutation({
      label: `friendship-request:${operationId}`,
      puts: [
        { store: STORES.friendship, record: friendship },
        { store: STORES.notification, record: notification },
      ],
    });
    return { friendship, duplicate: false, invalidatedDomains: INVALIDATED_DOMAINS };
  }

  async acceptFriendship(command = {}) {
    const { friendshipId, accepterId } = command;
    const friendship = this.repository
      ? await this.repository.getFriendship(friendshipId)
      : await this.facade.get(STORES.friendship, friendshipId);
    if (
      !friendship
      || friendship.status !== 'pending'
      || !friendship.players?.includes(accepterId)
      || friendship.requestedBy === accepterId
    ) {
      const error = new Error('This friendship request cannot be accepted.');
      error.code = 'not-acceptable';
      throw error;
    }
    const allFriendships = uniqueRelationships((await Promise.all(
      friendship.players.map((playerId) => (
        this.repository
          ? this.repository.listFriendshipsForPlayer(playerId)
          : this.facade.getFriendshipsForPlayer(playerId)
      )),
    )).flat());
    assertFriendshipCanBeAccepted({ friendship, friendships: allFriendships });
    if (this.repository) return this.repository.acceptFriendship(command);

    const {
      notificationId, operationId, acceptedAt = this.now(), inGameTimestamp = null,
      title = 'Friend Request Accepted', message = 'Your friend request was accepted.',
    } = command;
    if (!notificationId || !operationId) {
      throw new Error('Friendship acceptance requires notification and operation IDs.');
    }
    const at = new Date(acceptedAt).toISOString();
    const requesterId = friendship.players.find((playerId) => playerId !== accepterId);
    const notifications = await this.facade.getNotificationsForPlayer(accepterId);
    const requestNotification = notifications.find((row) => row.meta?.friendshipUUID === friendshipId);
    const accepted = { ...friendship, status: 'accepted', acceptedAt: at };
    const puts = [
      { store: STORES.friendship, record: accepted },
      { store: STORES.notification, record: {
        UUID: notificationId,
        parent: requesterId,
        title,
        message,
        kind: 'friend_accepted',
        createdAt: at,
        readAt: null,
        inGameTimestamp,
        meta: { friendshipUUID: friendshipId, accepterUUID: accepterId },
      } },
    ];
    if (requestNotification) {
      puts.push({ store: STORES.notification, record: { ...requestNotification, readAt: requestNotification.readAt || at } });
    }
    await this.facade.commitAtomicMutation({ label: `friendship-accept:${operationId}`, puts });
    return { friendship: accepted, duplicate: false, invalidatedDomains: INVALIDATED_DOMAINS };
  }

  async closeFriendship(command = {}) {
    if (this.repository) return this.repository.closeFriendship(command);
    const { friendshipId, actorId, operationId, closedAt = this.now() } = command;
    if (!friendshipId || !actorId || !operationId) {
      throw new Error('Closing a friendship requires relationship, actor, and operation IDs.');
    }
    const friendship = await this.facade.get(STORES.friendship, friendshipId);
    if (!friendship?.players?.includes(actorId)) {
      const error = new Error('This friendship cannot be changed by the current player.');
      error.code = 'not-closable';
      throw error;
    }
    const at = new Date(closedAt).toISOString();
    const notifications = await this.facade.getNotificationsForPlayer(actorId);
    const puts = notifications
      .filter((row) => row.meta?.friendshipUUID === friendshipId && !row.readAt)
      .map((record) => ({ store: STORES.notification, record: { ...record, readAt: at } }));
    await this.facade.commitAtomicMutation({
      label: `friendship-close:${operationId}`,
      puts,
      deletes: [{ store: STORES.friendship, UUID: friendshipId }],
    });
    return { friendshipId, duplicate: false, invalidatedDomains: INVALIDATED_DOMAINS };
  }
}

export default SocialWorldFriendshipService;
