export const PROFILE_CONTEXT_ACTION = Object.freeze({
  workNearby: 'work-nearby',
  encourage: 'encourage',
  offerHelp: 'offer-help',
  checkInLater: 'check-in-later',
  sendQuietly: 'send-quietly',
  viewGoal: 'view-goal',
  viewChronicle: 'view-chronicle',
  giveSpace: 'give-space',
});

export const PROFILE_CONTEXT_ACTIONS = Object.freeze([
  { id: PROFILE_CONTEXT_ACTION.workNearby, label: 'Work nearby', kind: 'presence' },
  { id: PROFILE_CONTEXT_ACTION.encourage, label: 'Encourage', kind: 'message' },
  { id: PROFILE_CONTEXT_ACTION.offerHelp, label: 'Offer help', kind: 'message' },
  { id: PROFILE_CONTEXT_ACTION.checkInLater, label: 'Check in later', kind: 'private-reminder' },
  { id: PROFILE_CONTEXT_ACTION.sendQuietly, label: 'Send quietly', kind: 'message' },
  { id: PROFILE_CONTEXT_ACTION.viewGoal, label: 'View goal', kind: 'navigation' },
  { id: PROFILE_CONTEXT_ACTION.viewChronicle, label: 'View chronicle', kind: 'navigation' },
  { id: PROFILE_CONTEXT_ACTION.giveSpace, label: 'Give space', kind: 'preference' },
]);

export function contextActionsForProjection(projection) {
  if (!projection || projection.viewerTier === 'self' || projection.viewerTier === 'outside') return [];
  const hasGoal = projection.goals?.some((item) => item.actionTarget?.type === 'goal');
  return PROFILE_CONTEXT_ACTIONS.filter((action) => action.id !== PROFILE_CONTEXT_ACTION.viewGoal || hasGoal);
}

