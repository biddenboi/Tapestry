export const RESIDENT_OCCUPANCY_FAILURE = Object.freeze({
  noCandidate: 'no-candidate',
  partialSupply: 'partial-supply',
  gatewayTimeout: 'gateway-timeout',
  gatewayUnavailable: 'gateway-unavailable',
  malformedResponse: 'malformed-response',
  privacyWithdrawn: 'privacy-withdrawn',
  blocked: 'blocked',
  moderated: 'moderated',
  publicProfileUnavailable: 'public-profile-unavailable',
  modeChanged: 'mode-changed',
  sourceInvalidated: 'source-invalidated',
  slotRemoved: 'slot-removed',
  profileChanged: 'profile-changed',
  friendCapacityReached: 'friend-capacity-reached',
});

export const RESIDENT_OCCUPANCY_FALLBACK = Object.freeze({
  primaryUnfilled: 'primary-unfilled-slots',
  primaryAffected: 'primary-affected-slots',
  primaryAll: 'primary-all-slots',
  retainUntilExpiry: 'retain-current-until-expiry',
  removeSlot: 'remove-slot',
  preserveOccupancy: 'preserve-occupancy',
});

const POLICY = Object.freeze({
  [RESIDENT_OCCUPANCY_FAILURE.noCandidate]: Object.freeze({
    fallback: RESIDENT_OCCUPANCY_FALLBACK.primaryUnfilled,
    clearVisibleResidents: false,
    retry: false,
  }),
  [RESIDENT_OCCUPANCY_FAILURE.partialSupply]: Object.freeze({
    fallback: RESIDENT_OCCUPANCY_FALLBACK.primaryUnfilled,
    clearVisibleResidents: false,
    retry: false,
  }),
  [RESIDENT_OCCUPANCY_FAILURE.gatewayTimeout]: Object.freeze({
    fallback: RESIDENT_OCCUPANCY_FALLBACK.primaryAll,
    clearVisibleResidents: true,
    retry: true,
  }),
  [RESIDENT_OCCUPANCY_FAILURE.gatewayUnavailable]: Object.freeze({
    fallback: RESIDENT_OCCUPANCY_FALLBACK.primaryAll,
    clearVisibleResidents: true,
    retry: true,
  }),
  [RESIDENT_OCCUPANCY_FAILURE.malformedResponse]: Object.freeze({
    fallback: RESIDENT_OCCUPANCY_FALLBACK.primaryAll,
    clearVisibleResidents: true,
    retry: true,
  }),
  [RESIDENT_OCCUPANCY_FAILURE.privacyWithdrawn]: Object.freeze({
    fallback: RESIDENT_OCCUPANCY_FALLBACK.primaryAffected,
    clearVisibleResidents: true,
    retry: true,
  }),
  [RESIDENT_OCCUPANCY_FAILURE.blocked]: Object.freeze({
    fallback: RESIDENT_OCCUPANCY_FALLBACK.primaryAffected,
    clearVisibleResidents: true,
    retry: false,
  }),
  [RESIDENT_OCCUPANCY_FAILURE.moderated]: Object.freeze({
    fallback: RESIDENT_OCCUPANCY_FALLBACK.primaryAffected,
    clearVisibleResidents: true,
    retry: false,
  }),
  [RESIDENT_OCCUPANCY_FAILURE.publicProfileUnavailable]: Object.freeze({
    fallback: RESIDENT_OCCUPANCY_FALLBACK.retainUntilExpiry,
    clearVisibleResidents: false,
    retry: true,
    controlsRemainEnabled: true,
  }),
  [RESIDENT_OCCUPANCY_FAILURE.modeChanged]: Object.freeze({
    fallback: RESIDENT_OCCUPANCY_FALLBACK.primaryAll,
    clearVisibleResidents: true,
    retry: true,
  }),
  [RESIDENT_OCCUPANCY_FAILURE.sourceInvalidated]: Object.freeze({
    fallback: RESIDENT_OCCUPANCY_FALLBACK.primaryAll,
    clearVisibleResidents: true,
    retry: true,
  }),
  [RESIDENT_OCCUPANCY_FAILURE.slotRemoved]: Object.freeze({
    fallback: RESIDENT_OCCUPANCY_FALLBACK.removeSlot,
    clearVisibleResidents: true,
    retry: false,
  }),
  [RESIDENT_OCCUPANCY_FAILURE.profileChanged]: Object.freeze({
    fallback: RESIDENT_OCCUPANCY_FALLBACK.primaryAll,
    clearVisibleResidents: true,
    retry: true,
  }),
  [RESIDENT_OCCUPANCY_FAILURE.friendCapacityReached]: Object.freeze({
    fallback: RESIDENT_OCCUPANCY_FALLBACK.preserveOccupancy,
    clearVisibleResidents: false,
    retry: false,
  }),
});

export function resolveResidentOccupancyFailure(reason) {
  return POLICY[reason] || POLICY[RESIDENT_OCCUPANCY_FAILURE.gatewayUnavailable];
}

export function classifyResidentOccupancyError(error) {
  if (error?.code === 'resident-candidate-timeout' || error?.name === 'AbortError') {
    return RESIDENT_OCCUPANCY_FAILURE.gatewayTimeout;
  }
  if (error instanceof TypeError) return RESIDENT_OCCUPANCY_FAILURE.malformedResponse;
  return RESIDENT_OCCUPANCY_FAILURE.gatewayUnavailable;
}

export default resolveResidentOccupancyFailure;
