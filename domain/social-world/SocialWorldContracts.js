export const SOCIAL_WORLD_CONTRACT_VERSION = 1;
export const PRESENCE_PROJECTION_VERSION = 1;

// Deliberately versioned product-tuning value. A recently ended activity remains
// a factual trace for 30 IGT minutes; it never becomes a current claim again.
export const RECENT_TRACE_WINDOW_IGT_MS = 30 * 60 * 1000;

export const PRESENCE_STATE = Object.freeze({
  current: 'current',
  projected: 'projected',
  recent: 'recent',
  inactive: 'inactive',
});

export const PRESENCE_CLAIM = Object.freeze({
  exactCurrent: 'exact-current',
  recordedInterval: 'recorded-interval',
  recentInterval: 'recent-interval',
  legacyTrace: 'legacy-trace',
  lastActive: 'last-active',
  none: 'none',
});

// Inactive is a presence state, not an interval location. Keeping it out of
// this enum prevents stored intervals such as "entered inactive".
export const SEMANTIC_LOCATION = Object.freeze({
  planning: 'planning',
  taskSession: 'task-session',
  dojo: 'dojo',
  matchArena: 'match-arena',
  marketplace: 'marketplace',
  commons: 'commons',
});

export const CAST_ROLE = Object.freeze({
  nearPeer: 'near-peer',
  horizon: 'horizon',
  friend: 'friend',
  self: 'self',
});

export const VISIBILITY_TIER = Object.freeze({
  self: 'self',
  friend: 'friend',
  dynamic: 'dynamic',
  outside: 'outside',
});

export const CAST_CAPACITY = Object.freeze({
  dynamicSlots: 2,
  maxFriends: 3,
  maxSurroundingProfiles: 5,
  maxSceneProfilesIncludingSelf: 6,
});

export const PRESENCE_INTERRUPTION = Object.freeze({
  surfaceExit: 'surface-exit',
  appBackground: 'app-background',
  appClose: 'app-close',
  profileSwitch: 'profile-switch',
  interruption: 'interruption',
  completed: 'completed',
  pause: 'pause',
});

export const PRESENCE_SURFACE = Object.freeze({
  semanticScene: 'semantic-scene',
  tavern: 'tavern',
  compactDrawer: 'compact-profile-drawer',
  lobbyPulse: 'lobby-pulse',
  dojoRoom: 'dojo-room',
  matchArena: 'match-arena',
  inactiveRail: 'inactive-rail',
  outsideOverview: 'outside-overview',
});

export const MEANINGFUL_ACTIVITY_KIND = Object.freeze({
  taskSessionStarted: 'task-session-started',
  taskSessionCompleted: 'task-session-completed',
  dojoEntered: 'dojo-entered',
  dojoExited: 'dojo-exited',
  matchStarted: 'match-started',
  matchConcluded: 'match-concluded',
  planningEntered: 'planning-entered',
  planningExited: 'planning-exited',
  marketplaceEntered: 'marketplace-entered',
  marketplaceExited: 'marketplace-exited',
  commonsEntered: 'commons-entered',
  commonsExited: 'commons-exited',
});

export const CURRENT_CAPABLE_SURFACES = Object.freeze([
  PRESENCE_SURFACE.semanticScene,
  PRESENCE_SURFACE.tavern,
  PRESENCE_SURFACE.compactDrawer,
  PRESENCE_SURFACE.lobbyPulse,
  PRESENCE_SURFACE.dojoRoom,
  PRESENCE_SURFACE.matchArena,
]);

export const SURFACE_ALLOWED_PRESENCE_STATES = deepFreeze({
  [PRESENCE_SURFACE.semanticScene]: [
    PRESENCE_STATE.current,
    PRESENCE_STATE.projected,
    PRESENCE_STATE.recent,
  ],
  [PRESENCE_SURFACE.tavern]: [
    PRESENCE_STATE.current,
    PRESENCE_STATE.projected,
  ],
  [PRESENCE_SURFACE.compactDrawer]: Object.values(PRESENCE_STATE),
  [PRESENCE_SURFACE.lobbyPulse]: [
    PRESENCE_STATE.current,
    PRESENCE_STATE.projected,
  ],
  [PRESENCE_SURFACE.dojoRoom]: [
    PRESENCE_STATE.current,
    PRESENCE_STATE.projected,
  ],
  [PRESENCE_SURFACE.matchArena]: [
    PRESENCE_STATE.current,
    PRESENCE_STATE.projected,
  ],
  [PRESENCE_SURFACE.inactiveRail]: [
    PRESENCE_STATE.recent,
    PRESENCE_STATE.inactive,
  ],
  [PRESENCE_SURFACE.outsideOverview]: [PRESENCE_STATE.inactive],
});

export const COMPACT_PROFILE_DRAWER_CONTRACT = deepFreeze({
  sectionOrder: ['now', 'today', 'thread', 'next', 'new'],
  maxFactsPerSection: 2,
  sections: {
    now: {
      required: ['presenceState', 'claim'],
      optional: [
        'location',
        'elapsedHere',
        'activeElapsed',
        'activity',
        'paused',
        'pointsOrProgress',
      ],
    },
    today: {
      required: [],
      optional: [
        'sessionCount',
        'points',
        'taskCount',
        'matchSummary',
        'dojoSummary',
        'majorChanges',
      ],
    },
    thread: {
      required: [],
      optional: ['goal', 'project', 'ongoingObjective', 'repeatedWork'],
    },
    next: {
      required: [],
      optional: ['dueTask', 'scheduledItem', 'authoredNextStep', 'recurringEvent'],
      evidence: 'explicit-only',
    },
    new: {
      required: [],
      optional: ['meaningfulChangeCount', 'sinceLastEncounterLink'],
    },
  },
});

export function canSurfaceRenderPresenceState(surface, state) {
  return SURFACE_ALLOWED_PRESENCE_STATES[surface]?.includes(state) === true;
}

export function canSurfaceClaimCurrent(surface) {
  return CURRENT_CAPABLE_SURFACES.includes(surface);
}

export function isMeaningfulActivityKind(kind) {
  return Object.values(MEANINGFUL_ACTIVITY_KIND).includes(kind);
}

export function isSemanticLocation(location) {
  return Object.values(SEMANTIC_LOCATION).includes(location);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
