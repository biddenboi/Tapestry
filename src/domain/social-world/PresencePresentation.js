import { formatDuration, formatWorldIGT } from '../time/Time.js';
import { PRESENCE_STATE, SEMANTIC_LOCATION } from './SocialWorldContracts.js';

export const SEMANTIC_LOCATION_LABEL = Object.freeze({
  [SEMANTIC_LOCATION.planning]: 'Planning',
  [SEMANTIC_LOCATION.taskSession]: 'Task Session',
  [SEMANTIC_LOCATION.dojo]: 'Dojo',
  [SEMANTIC_LOCATION.matchArena]: 'Match Arena',
  [SEMANTIC_LOCATION.marketplace]: 'Marketplace',
  [SEMANTIC_LOCATION.commons]: 'Commons',
});

const PANEL_ACTIVITY_LABEL = Object.freeze({
  feed: 'Feed',
  events: 'Events',
  inventory: 'Inventory',
  pass: 'Contribution Pass',
  profile: 'Profile',
  inbox: 'Inbox',
});

function surfaceActivityLabel(presence) {
  if (presence?.sourceType !== 'panel') return null;
  return PANEL_ACTIVITY_LABEL[String(presence?.sourceId || '')] || null;
}

export function buildPresencePresentation(presence, viewerIGT) {
  const state = presence?.state || PRESENCE_STATE.inactive;
  const locationLabel = SEMANTIC_LOCATION_LABEL[presence?.location] || null;
  const activityLabel = surfaceActivityLabel(presence);
  const elapsedHereLabel = presence?.elapsedHere == null
    ? null
    : formatDuration(presence.elapsedHere) || '0m';
  const activeElapsedLabel = presence?.activeElapsed == null
    ? null
    : formatDuration(presence.activeElapsed) || '0m';
  const agoLabel = presence?.endedIGT == null
    ? null
    : formatDuration(Math.max(0, Number(viewerIGT || 0) - presence.endedIGT)) || '0m';

  if (state === PRESENCE_STATE.current || state === PRESENCE_STATE.projected) {
    const facts = [
      elapsedHereLabel ? `Here ${elapsedHereLabel}` : null,
      activeElapsedLabel != null && activeElapsedLabel !== elapsedHereLabel
        ? `focused ${activeElapsedLabel}`
        : null,
    ].filter(Boolean);
    return Object.freeze({
      state,
      locationLabel,
      statusLabel: presence.paused ? 'Paused' : state === PRESENCE_STATE.current ? 'Current' : 'Projected',
      elapsedHereLabel,
      activeElapsedLabel,
      primary: [
        locationLabel,
        activityLabel ? `Viewing ${activityLabel}` : null,
        ...facts,
      ].filter(Boolean).join(' · '),
      secondary: presence.paused ? 'Productive time is paused; presence continues.' : null,
    });
  }

  if (state === PRESENCE_STATE.recent) {
    return Object.freeze({
      state,
      locationLabel,
      statusLabel: 'Recent',
      elapsedHereLabel,
      activeElapsedLabel,
      primary: locationLabel ? `Left ${locationLabel}${agoLabel ? ` ${agoLabel} ago` : ''}` : 'Recently active',
      secondary: elapsedHereLabel ? `${elapsedHereLabel} total` : 'Duration unavailable from this activity trace',
    });
  }

  return Object.freeze({
    state: PRESENCE_STATE.inactive,
    locationLabel: null,
    statusLabel: 'Inactive',
    elapsedHereLabel: null,
    activeElapsedLabel: null,
    primary: presence?.lastActiveIGT == null
      ? 'No recent activity'
      : `Last active ${formatWorldIGT(presence.lastActiveIGT)}`,
    secondary: null,
  });
}

export default buildPresencePresentation;
