export const NEXT_MOVE_REASON = Object.freeze({
  activePairMatch: 'active-pair-match',
  activeDojo: 'active-dojo-session',
  activeTask: 'active-task-session',
  fixedCommitment: 'fixed-commitment-imminent',
  preparationRequired: 'transition-preparation-required',
  savedContinuation: 'saved-continuation',
  continuationFeasible: 'continuation-feasible',
  taskExecutable: 'task-executable-now',
  v12Selected: 'task-recommender-v12-selected',
  higherPriorityAmbiguity: 'higher-priority-ambiguity',
  planningCanUnlock: 'bounded-clarification-can-unlock',
  scheduleConflict: 'schedule-conflict',
  noTaskFitsWindow: 'no-task-fits-window',
  competingUrgentTasks: 'competing-urgent-tasks',
  goalMissingMilestone: 'goal-missing-current-milestone',
  goalDirectionConflict: 'goal-direction-conflict',
  meaningfulBoundary: 'meaningful-boundary',
  recoveryAfterEffort: 'recovery-after-effort',
  noUrgency: 'no-fixed-or-urgent-work',
  feasibilityUnknown: 'feasibility-unknown',
  evidenceInsufficient: 'evidence-insufficient',
  suppressed: 'exact-suggestion-suppressed',
  noJustifiedMove: 'no-justified-move',
});

const COPY = Object.freeze({
  [NEXT_MOVE_REASON.activePairMatch]: 'A Pair Match is active.',
  [NEXT_MOVE_REASON.activeDojo]: 'A Dojo session is active.',
  [NEXT_MOVE_REASON.activeTask]: 'A task session is already in progress.',
  [NEXT_MOVE_REASON.fixedCommitment]: 'A fixed commitment is approaching.',
  [NEXT_MOVE_REASON.preparationRequired]: 'Transition or preparation time is required now.',
  [NEXT_MOVE_REASON.savedContinuation]: 'Your previous boundary preserved a next visible action.',
  [NEXT_MOVE_REASON.continuationFeasible]: 'The saved continuation is still available and feasible.',
  [NEXT_MOVE_REASON.taskExecutable]: 'This task can produce useful progress now.',
  [NEXT_MOVE_REASON.v12Selected]: 'V12 selected this task from the executable set.',
  [NEXT_MOVE_REASON.higherPriorityAmbiguity]: 'A more urgent task is blocked only by an unclear next step.',
  [NEXT_MOVE_REASON.planningCanUnlock]: 'One bounded clarification can make that task executable.',
  [NEXT_MOVE_REASON.scheduleConflict]: 'The current day contains a real scheduling conflict.',
  [NEXT_MOVE_REASON.noTaskFitsWindow]: 'No current task fits the available window.',
  [NEXT_MOVE_REASON.competingUrgentTasks]: 'Several urgent tasks compete without a chosen order.',
  [NEXT_MOVE_REASON.goalMissingMilestone]: 'An active Goal has no current milestone.',
  [NEXT_MOVE_REASON.goalDirectionConflict]: 'Goal direction must be resolved before useful work can be chosen.',
  [NEXT_MOVE_REASON.meaningfulBoundary]: 'A meaningful transition contains context worth preserving.',
  [NEXT_MOVE_REASON.recoveryAfterEffort]: 'A sustained work period just ended.',
  [NEXT_MOVE_REASON.noUrgency]: 'Nothing fixed or urgent requires an immediate transition.',
  [NEXT_MOVE_REASON.feasibilityUnknown]: 'One missing feasibility fact would change the recommendation.',
  [NEXT_MOVE_REASON.evidenceInsufficient]: 'The available evidence does not justify a single recommendation.',
  [NEXT_MOVE_REASON.suppressed]: 'You dismissed this exact suggestion and its source has not changed.',
  [NEXT_MOVE_REASON.noJustifiedMove]: 'No intervention is justified by the current state.',
});

export function explainNextMoveReason(code) {
  return COPY[code] || String(code || '').replaceAll('-', ' ');
}

export function explainNextMoveReasons(codes = []) {
  return [...new Set(codes)].map((code) => ({
    code,
    text: explainNextMoveReason(code),
  }));
}
