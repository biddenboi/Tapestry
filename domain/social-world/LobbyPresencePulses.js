import {
  PRESENCE_STATE,
  SEMANTIC_LOCATION,
} from './SocialWorldContracts.js';

const ACTIVE_PULSE_STATES = new Set([
  PRESENCE_STATE.current,
  PRESENCE_STATE.projected,
]);

export function selectLobbyPresenceMembers(
  scene,
  location,
  { excludeProfileId = null, limit = 3 } = {},
) {
  if (!scene || !Object.values(SEMANTIC_LOCATION).includes(location)) return Object.freeze([]);
  const excluded = excludeProfileId == null ? null : String(excludeProfileId);
  return Object.freeze((scene.members || [])
    .filter((member) => (
      String(member?.profileId || '') !== excluded
      && member?.presence?.location === location
      && ACTIVE_PULSE_STATES.has(member?.presence?.state)
    ))
    .slice(0, Math.max(0, Math.trunc(Number(limit) || 0))));
}

export function selectLobbyActivityPulses(scene, options = {}) {
  return Object.freeze({
    match: selectLobbyPresenceMembers(scene, SEMANTIC_LOCATION.matchArena, options),
    dojo: selectLobbyPresenceMembers(scene, SEMANTIC_LOCATION.dojo, options),
  });
}

export default selectLobbyActivityPulses;
