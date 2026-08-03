import { buildProfileIdentity } from '../profile/ProfileIdentity.js';
import { getRankGroupPresentation } from '../rank/Rank.js';
import { formatDuration } from '../time/Time.js';
import {
  OCCUPANT_KIND,
  RESIDENT_PRESENCE_CARD_VERSION,
  RESIDENT_TIME_BASIS,
  isResidentActivityCategory,
} from './ResidentSubstitutionContracts.js';

export const RESIDENT_CARD_KEYS = Object.freeze([
  'schemaVersion',
  'profileId',
  'identity',
  'activity',
  'timeBasis',
  'navigation',
]);

export const RESIDENT_CARD_IDENTITY_KEYS = Object.freeze([
  'profileId',
  'username',
  'profilePicture',
  'title',
  'frame',
  'theme',
  'rankGroup',
]);

export const RESIDENT_CARD_ACTIVITY_KEYS = Object.freeze(['category']);
export const RESIDENT_CARD_NAVIGATION_KEYS = Object.freeze(['type', 'profileId']);

export const RESIDENT_ACTIVITY_LABEL = Object.freeze({
  planning: 'Planning',
  'task-session': 'Task Session',
  dojo: 'Dojo',
  'match-arena': 'Match',
  marketplace: 'Marketplace',
});

export function residentActivityLabel(category, { allowGenericActive = false } = {}) {
  const key = String(category || '');
  if (RESIDENT_ACTIVITY_LABEL[key]) return RESIDENT_ACTIVITY_LABEL[key];
  return allowGenericActive && key === 'commons' ? 'Active' : null;
}

export function buildOccupantAccessibleName({
  identity = null,
  name = null,
  occupantKind = OCCUPANT_KIND.familiar,
  timeBasis = RESIDENT_TIME_BASIS.familiar,
  activityCategory = null,
  residentCard = null,
  presence = null,
} = {}) {
  const username = String(name || identity?.username || 'Player');
  if (occupantKind !== OCCUPANT_KIND.resident) return `Inspect ${username}. Open profile.`;
  const activity = residentActivityLabel(
    activityCategory || residentCard?.activity?.category,
    { allowGenericActive: true },
  ) || 'Activity unavailable';
  const elapsed = presence?.elapsedHere == null
    ? ''
    : ` Here ${formatDuration(presence.elapsedHere) || '0m'}.`;
  return timeBasis === RESIDENT_TIME_BASIS.liveWallClock
    ? `${username}, unfamiliar player, live in ${activity}.${elapsed} Open public profile.`
    : `${username}, unfamiliar player, in ${activity} at your current in-game time.${elapsed} Open public profile.`;
}

function residentIdentityModel(identity = {}) {
  const prepared = buildProfileIdentity(identity);
  if (!prepared.profileId) return null;
  return Object.freeze({
    profileId: prepared.profileId,
    username: prepared.username,
    profilePicture: prepared.profilePicture,
    title: prepared.title,
    frame: prepared.frame,
    theme: prepared.theme,
    rankGroup: identity.rankGroup
      ? getRankGroupPresentation(identity.rankGroup).group
      : null,
  });
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length
    && actual.every((key, index) => key === required[index]);
}

export function buildResidentPresenceCard({
  identity,
  activityCategory,
  timeBasis,
  allowGenericActive = false,
} = {}) {
  const preparedIdentity = residentIdentityModel(identity);
  if (!preparedIdentity) {
    throw new TypeError('A resident presence card requires a public profile identity.');
  }
  if (!isResidentActivityCategory(activityCategory, { allowGenericActive })) {
    throw new TypeError(`Unsupported resident activity category: ${activityCategory}`);
  }
  if (![RESIDENT_TIME_BASIS.liveWallClock, RESIDENT_TIME_BASIS.viewerIGT].includes(timeBasis)) {
    throw new TypeError(`Unsupported resident time basis: ${timeBasis}`);
  }

  return Object.freeze({
    schemaVersion: RESIDENT_PRESENCE_CARD_VERSION,
    profileId: preparedIdentity.profileId,
    identity: preparedIdentity,
    activity: Object.freeze({ category: activityCategory }),
    timeBasis,
    navigation: Object.freeze({
      type: 'stranger-profile',
      profileId: preparedIdentity.profileId,
    }),
  });
}

export function assertResidentPresenceCard(card) {
  if (!exactKeys(card, RESIDENT_CARD_KEYS)
      || !exactKeys(card?.identity, RESIDENT_CARD_IDENTITY_KEYS)
      || !exactKeys(card?.activity, RESIDENT_CARD_ACTIVITY_KEYS)
      || !exactKeys(card?.navigation, RESIDENT_CARD_NAVIGATION_KEYS)) {
    throw new TypeError('Resident presence card contains fields outside the public activity-only contract.');
  }
  if (card.schemaVersion !== RESIDENT_PRESENCE_CARD_VERSION
      || card.profileId !== card.identity.profileId
      || card.navigation.type !== 'stranger-profile'
      || card.navigation.profileId !== card.profileId
      || !isResidentActivityCategory(card.activity.category, { allowGenericActive: true })
      || ![RESIDENT_TIME_BASIS.liveWallClock, RESIDENT_TIME_BASIS.viewerIGT].includes(card.timeBasis)) {
    throw new TypeError('Resident presence card violates the public activity-only contract.');
  }
  return true;
}

export function buildResidentOccupant(card, presence = null) {
  assertResidentPresenceCard(card);
  return Object.freeze({
    kind: OCCUPANT_KIND.resident,
    profileId: card.profileId,
    identity: card.identity,
    presence: presence ? Object.freeze({ ...presence }) : null,
    timeBasis: card.timeBasis,
    residentCard: card,
  });
}

export default buildResidentPresenceCard;
