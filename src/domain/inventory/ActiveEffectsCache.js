const CACHE_BY_CONNECTION = new WeakMap();

function normalizeEffect(effect = {}) {
  const multiplierValue = Number(effect.multiplierValue);
  const expiresAt = effect.expiresAt || null;
  return Object.freeze({
    UUID: effect.UUID || null,
    parent: effect.parent || null,
    eventUUID: effect.eventUUID || null,
    label: String(effect.label || ''),
    source: effect.source || null,
    multiplierValue: Number.isFinite(multiplierValue) ? multiplierValue : 1,
    appliedAt: effect.appliedAt || null,
    expiresAt,
    metadata: effect.metadata && typeof effect.metadata === 'object'
      ? Object.freeze({ ...effect.metadata })
      : null,
  });
}

function connectionCache(databaseConnection) {
  let cache = CACHE_BY_CONNECTION.get(databaseConnection);
  if (!cache) {
    cache = new Map();
    CACHE_BY_CONNECTION.set(databaseConnection, cache);
  }
  return cache;
}

export async function getNormalizedActiveEffects(
  databaseConnection,
  playerUUID,
  eventRevision = 0,
) {
  if (!databaseConnection || !playerUUID) return Object.freeze([]);
  const key = `${playerUUID}:${Number(eventRevision) || 0}`;
  const cache = connectionCache(databaseConnection);
  if (cache.has(key)) return cache.get(key);

  const pending = Promise.resolve(databaseConnection.getActiveEventBuffsForPlayer(playerUUID))
    .then((effects) => Object.freeze((effects || []).map(normalizeEffect)))
    .catch((error) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, pending);

  // Keep only the latest two revisions for this player.
  const prefix = `${playerUUID}:`;
  const matching = [...cache.keys()].filter((candidate) => candidate.startsWith(prefix));
  while (matching.length > 2) cache.delete(matching.shift());
  return pending;
}

export function clearActiveEffectsCache(databaseConnection, playerUUID = null) {
  const cache = CACHE_BY_CONNECTION.get(databaseConnection);
  if (!cache) return;
  if (!playerUUID) {
    cache.clear();
    return;
  }
  const prefix = `${playerUUID}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
