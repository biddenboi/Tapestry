function profilePlayerId(player) {
  const value = player?.UUID ?? player?.id ?? player?.profileId;
  return value == null ? null : String(value);
}

function normalizedPlayer(player, profileId = profilePlayerId(player)) {
  if (!player || !profileId) return null;
  return {
    ...player,
    UUID: String(profileId),
  };
}

export function mergeProfilePlayer(typedPlayer, documentPlayer) {
  const typedId = profilePlayerId(typedPlayer);
  const documentId = profilePlayerId(documentPlayer);
  if (!typedId && !documentId) return null;
  if (typedId && documentId && typedId !== documentId) {
    throw new TypeError('Cannot merge profile player records with different IDs.');
  }
  const profileId = typedId || documentId;
  return normalizedPlayer({
    ...(typedPlayer || {}),
    ...(documentPlayer || {}),
  }, profileId);
}

export function mergeProfilePlayerLists(typedPlayers = [], documentPlayers = []) {
  const typedById = new Map();
  const documentById = new Map();
  const orderedIds = [];

  for (const player of typedPlayers || []) {
    const profileId = profilePlayerId(player);
    if (!profileId) continue;
    if (!typedById.has(profileId)) orderedIds.push(profileId);
    typedById.set(profileId, player);
  }
  for (const player of documentPlayers || []) {
    const profileId = profilePlayerId(player);
    if (!profileId) continue;
    if (!typedById.has(profileId) && !documentById.has(profileId)) {
      orderedIds.push(profileId);
    }
    documentById.set(profileId, player);
  }

  return orderedIds
    .map((profileId) => mergeProfilePlayer(
      typedById.get(profileId) || null,
      documentById.get(profileId) || null,
    ))
    .filter(Boolean);
}
