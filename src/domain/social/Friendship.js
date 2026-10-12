export const MAX_FRIENDS = 3;

export const FRIEND_CAPACITY_ERROR = 'friend-cap-reached';

function asId(value) {
  return value == null ? '' : String(value);
}

function membersOf(friendship) {
  return [...new Set((friendship?.players || []).map(asId).filter(Boolean))];
}

function friendshipSortKey(friendship) {
  return [
    String(friendship?.acceptedAt || friendship?.createdAt || ''),
    asId(friendship?.UUID || friendship?.id),
  ];
}

export function isAcceptedFriendship(friendship) {
  return friendship?.status === 'accepted' && membersOf(friendship).length === 2;
}

export function getOtherFriendId(friendship, playerId) {
  const id = asId(playerId);
  if (!id || !isAcceptedFriendship(friendship)) return null;
  const members = membersOf(friendship);
  if (!members.includes(id)) return null;
  return members.find((memberId) => memberId !== id) || null;
}

export function getAcceptedFriendships(playerId, friendships = []) {
  const id = asId(playerId);
  return (friendships || [])
    .filter((friendship) => getOtherFriendId(friendship, id))
    .sort((left, right) => {
      const [leftAt, leftId] = friendshipSortKey(left);
      const [rightAt, rightId] = friendshipSortKey(right);
      return leftAt.localeCompare(rightAt) || leftId.localeCompare(rightId);
    });
}

export function getAcceptedFriendIds(playerId, friendships = []) {
  return getAcceptedFriendships(playerId, friendships)
    .map((friendship) => getOtherFriendId(friendship, playerId));
}

export function getFriendshipCapacity(playerId, friendships = []) {
  const friendCount = getAcceptedFriendIds(playerId, friendships).length;
  const maxFriends = MAX_FRIENDS;
  return Object.freeze({
    playerId: asId(playerId),
    friendCount,
    maxFriends,
    emptyFriendSlots: Math.max(0, maxFriends - friendCount),
    isFull: friendCount >= maxFriends,
  });
}

export function assertFriendshipCanBeAccepted({ friendship, friendships = [] } = {}) {
  const members = membersOf(friendship);
  if (members.length !== 2) throw new TypeError('Friendship acceptance requires exactly two distinct players.');
  if (friendship?.status === 'accepted') return Object.freeze({ allowed: true, alreadyAccepted: true });

  const blockedPlayerIds = members.filter((playerId) => (
    getFriendshipCapacity(playerId, friendships).isFull
  ));
  if (blockedPlayerIds.length) {
    const error = new Error('A player already has three friends. End an existing friendship before accepting another.');
    error.code = FRIEND_CAPACITY_ERROR;
    error.details = Object.freeze({
      maxFriends: MAX_FRIENDS,
      blockedPlayerIds: Object.freeze(blockedPlayerIds),
    });
    throw error;
  }
  return Object.freeze({ allowed: true, alreadyAccepted: false });
}

