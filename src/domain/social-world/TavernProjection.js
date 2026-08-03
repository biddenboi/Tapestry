import {
  CAST_ROLE,
  PRESENCE_STATE,
  isSemanticLocation,
} from './SocialWorldContracts.js';

function roleOrder(role) {
  if (role === CAST_ROLE.self) return 0;
  if (role === CAST_ROLE.friend) return 1;
  if (role === CAST_ROLE.nearPeer) return 2;
  if (role === CAST_ROLE.horizon) return 3;
  return 4;
}

export function compareStableCastOrder(left, right) {
  return roleOrder(left?.role) - roleOrder(right?.role)
    || String(left?.identity?.username || '').localeCompare(String(right?.identity?.username || ''))
    || String(left?.profileId || '').localeCompare(String(right?.profileId || ''));
}

/**
 * Taverns are an ephemeral projection over live semantic co-presence. They
 * have no persistence, reward, geographic, or ownership state.
 */
export function buildTaverns(members = []) {
  const byLocation = new Map();
  for (const member of members) {
    if (![PRESENCE_STATE.current, PRESENCE_STATE.projected].includes(member?.presence?.state)) continue;
    const location = member.presence.location;
    if (!isSemanticLocation(location)) continue;
    const occupants = byLocation.get(location) || [];
    occupants.push(member);
    byLocation.set(location, occupants);
  }
  return Object.freeze([...byLocation.entries()]
    .filter(([, occupants]) => occupants.length >= 2)
    .map(([location, occupants]) => Object.freeze({
      id: `tavern:${location}`,
      location,
      count: occupants.length,
      occupants: Object.freeze([...occupants].sort(compareStableCastOrder)),
    }))
    .sort((left, right) => left.location.localeCompare(right.location)));
}

export default buildTaverns;
