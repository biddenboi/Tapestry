/**
 * Match record accessors.
 *
 * Conquest and breach share most top-level fields (UUID, createdAt, teams,
 * result, status) but have mode-specific state. The architecture doc
 * recommends a polymorphic `match.state` envelope so code that cares only
 * about common fields doesn't branch on mode, and code that accesses
 * mode-specific state can locate it without reaching through different field
 * names per mode.
 *
 * For the load-bearing slice we only need breach's accessors; conquest still
 * stores its state at the top level as it historically has. A later pass can
 * migrate conquest into the same envelope.
 */

export const MODE = Object.freeze({
  conquest: 'conquest',
  breach: 'breach',
});

export function getMode(match) {
  return match?.mode || MODE.conquest;
}

export function isBreach(match) {
  return getMode(match) === MODE.breach;
}

export function isConquest(match) {
  return getMode(match) === MODE.conquest;
}

/**
 * Extract the mode-specific state blob. For breach, this is `match.breach`;
 * for conquest, it's the match root itself (legacy layout).
 */
export function getModeState(match) {
  if (!match) return null;
  if (isBreach(match)) return match.breach || null;
  return match;
}

/**
 * Produce a new match record with its mode-specific state replaced.
 * Pure; the caller persists.
 */
export function setModeState(match, nextState) {
  if (!match) return match;
  if (isBreach(match)) return { ...match, breach: nextState };
  return { ...match, ...nextState };
}
