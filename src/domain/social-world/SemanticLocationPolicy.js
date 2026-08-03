import {
  PRESENCE_INTERRUPTION,
  SEMANTIC_LOCATION,
} from './SocialWorldContracts.js';

export const LOCATION_CONTINUITY_POLICY = deepFreeze({
  [SEMANTIC_LOCATION.planning]: {
    tracksActiveElapsed: false,
    recoverableAfterReload: false,
  },
  [SEMANTIC_LOCATION.taskSession]: {
    tracksActiveElapsed: true,
    recoverableAfterReload: false,
  },
  [SEMANTIC_LOCATION.dojo]: {
    tracksActiveElapsed: true,
    recoverableAfterReload: false,
  },
  [SEMANTIC_LOCATION.matchArena]: {
    tracksActiveElapsed: false,
    recoverableAfterReload: true,
  },
  [SEMANTIC_LOCATION.marketplace]: {
    tracksActiveElapsed: false,
    recoverableAfterReload: false,
  },
  [SEMANTIC_LOCATION.commons]: {
    tracksActiveElapsed: false,
    recoverableAfterReload: false,
  },
});

// Stronger domain contexts win over nested activity details. A task completed
// in a Match or Dojo therefore remains detail within that location.
export function resolveSemanticLocation({
  gameState,
  activeTask,
  activePanel,
} = {}) {
  if (gameState === 'match') return SEMANTIC_LOCATION.matchArena;
  if (gameState === 'dojo') return SEMANTIC_LOCATION.dojo;
  if (activeTask?.createdAt) return SEMANTIC_LOCATION.taskSession;
  if (activePanel === 'tasks' || activePanel === 'queue') return SEMANTIC_LOCATION.planning;
  if (activePanel === 'shop') return SEMANTIC_LOCATION.marketplace;
  if (gameState === 'idle') return SEMANTIC_LOCATION.commons;
  return null;
}

export function getLocationContinuityPolicy(location) {
  return LOCATION_CONTINUITY_POLICY[location] || null;
}

export function shouldClosePresence({
  location,
  interruption,
  domainSupportsRecovery = false,
} = {}) {
  if (!LOCATION_CONTINUITY_POLICY[location]) return true;
  if (interruption === PRESENCE_INTERRUPTION.pause) return false;
  if (interruption === PRESENCE_INTERRUPTION.completed) return true;
  if (interruption === PRESENCE_INTERRUPTION.profileSwitch) return true;

  const isLifecycleBoundary = [
    PRESENCE_INTERRUPTION.surfaceExit,
    PRESENCE_INTERRUPTION.appBackground,
    PRESENCE_INTERRUPTION.appClose,
    PRESENCE_INTERRUPTION.interruption,
  ].includes(interruption);

  if (!isLifecycleBoundary) return false;

  const mayRecover = LOCATION_CONTINUITY_POLICY[location].recoverableAfterReload
    && domainSupportsRecovery;
  return !mayRecover;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
