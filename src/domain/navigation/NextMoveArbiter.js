import {
  createNextMoveDecision,
  NEXT_MOVE_RESULT,
} from './NextMoveDecision.js';
import { NEXT_MOVE_CONFIDENCE } from './NextMoveConfidence.js';
import { NEXT_MOVE_REASON } from './NextMoveReasonCodes.js';
import { clarificationShouldPreemptWork } from './NextMovePolicyV1.js';

function route(panel, candidate = {}) {
  return candidate.destination || {
    panel,
    entityType: candidate.entityType,
    entityUUID: candidate.entityUUID || candidate.UUID || null,
    subview: candidate.subview || null,
    focusTarget: candidate.focusTarget || null,
    routeLabel: candidate.routeLabel || candidate.title || panel,
    worldLocationId: candidate.worldLocationId || panel,
  };
}

function decision(state, resultType, candidate, defaults = {}) {
  return createNextMoveDecision({
    playerUUID: state.playerUUID,
    decisionPoint: state.decisionPoint,
    resultType,
    phase: defaults.phase || resultType,
    title: candidate?.title || defaults.title,
    context: candidate?.context || defaults.context,
    destination: candidate?.destination || defaults.destination || null,
    primaryAction: candidate?.primaryAction || defaults.primaryAction || null,
    reasonCodes: candidate?.reasonCodes || defaults.reasonCodes || [],
    confidence: candidate?.confidence || defaults.confidence || NEXT_MOVE_CONFIDENCE.high,
    sourceEntityRefs: candidate?.sourceEntityRefs || defaults.sourceEntityRefs || [],
    invalidationKeys: candidate?.invalidationKeys || defaults.invalidationKeys || [],
    alternatives: state.alternatives || [],
    question: candidate?.question || defaults.question || null,
    secondaryAction: candidate?.secondaryAction || defaults.secondaryAction || null,
  });
}

export function chooseNextMove(state = {}) {
  if (!state.playerUUID) throw new Error('NextMoveArbiter requires a player UUID.');

  if (state.activePairMatch) {
    return decision(state, NEXT_MOVE_RESULT.active, state.activePairMatch, {
      phase: 'continue',
      title: 'Pair Match in progress',
      destination: route('lobby', state.activePairMatch),
      reasonCodes: [NEXT_MOVE_REASON.activePairMatch],
    });
  }
  if (state.activeDojoSession) {
    return decision(state, NEXT_MOVE_RESULT.active, state.activeDojoSession, {
      phase: 'continue',
      title: 'Dojo session in progress',
      destination: route('lobby', state.activeDojoSession),
      reasonCodes: [NEXT_MOVE_REASON.activeDojo],
    });
  }
  if (state.activeTaskSession) {
    return decision(state, NEXT_MOVE_RESULT.active, state.activeTaskSession, {
      phase: 'continue',
      title: state.activeTaskSession.title || 'Current task',
      destination: route('tasks', state.activeTaskSession),
      reasonCodes: [NEXT_MOVE_REASON.activeTask],
    });
  }
  if (state.imminentCommitment) {
    return decision(state, NEXT_MOVE_RESULT.commitment, state.imminentCommitment, {
      phase: 'continue',
      destination: route(state.imminentCommitment.panel || 'events', state.imminentCommitment),
      reasonCodes: [
        NEXT_MOVE_REASON.fixedCommitment,
        NEXT_MOVE_REASON.preparationRequired,
      ],
    });
  }
  if (state.continuation) {
    return decision(state, NEXT_MOVE_RESULT.continue, state.continuation, {
      phase: 'continue',
      destination: route(state.continuation.panel || 'tasks', state.continuation),
      reasonCodes: [
        NEXT_MOVE_REASON.savedContinuation,
        NEXT_MOVE_REASON.continuationFeasible,
      ],
    });
  }

  if (clarificationShouldPreemptWork(state.clarification, state.executableWork)) {
    return decision(state, NEXT_MOVE_RESULT.clarify, state.clarification, {
      phase: 'clarify',
      destination: route('tasks', {
        ...state.clarification,
        subview: 'clarify',
        focusTarget: 'next-action',
      }),
      reasonCodes: [
        NEXT_MOVE_REASON.higherPriorityAmbiguity,
        NEXT_MOVE_REASON.planningCanUnlock,
      ],
    });
  }
  if (state.executableWork) {
    return decision(state, NEXT_MOVE_RESULT.execute, state.executableWork, {
      phase: 'execute',
      destination: route('tasks', {
        ...state.executableWork,
        subview: 'preview',
        focusTarget: 'begin-action',
      }),
      reasonCodes: [
        NEXT_MOVE_REASON.taskExecutable,
        NEXT_MOVE_REASON.v12Selected,
      ],
    });
  }
  if (state.dayOrientation) {
    return decision(state, NEXT_MOVE_RESULT.reorientDay, state.dayOrientation, {
      phase: 'reorient',
      destination: route('events', {
        ...state.dayOrientation,
        subview: 'today',
        focusTarget: 'day-orientation',
      }),
    });
  }
  if (state.goalDirection) {
    return decision(state, NEXT_MOVE_RESULT.reorientGoal, state.goalDirection, {
      phase: 'reorient',
      destination: route('events', {
        ...state.goalDirection,
        entityType: 'goal',
        subview: 'goal',
        focusTarget: 'current-milestone',
      }),
    });
  }
  if (state.reflection) {
    return decision(state, NEXT_MOVE_RESULT.reflect, state.reflection, {
      phase: 'reflect',
      destination: route('feed', {
        ...state.reflection,
        subview: 'today',
        focusTarget: 'append-entry',
      }),
      reasonCodes: [NEXT_MOVE_REASON.meaningfulBoundary],
    });
  }
  if (state.recovery) {
    return decision(state, NEXT_MOVE_RESULT.recover, state.recovery, {
      phase: 'recover',
      reasonCodes: [
        NEXT_MOVE_REASON.recoveryAfterEffort,
        NEXT_MOVE_REASON.noUrgency,
      ],
    });
  }
  if (state.feasibilityQuestion) {
    return decision(state, NEXT_MOVE_RESULT.ask, state.feasibilityQuestion, {
      phase: 'clarify',
      confidence: NEXT_MOVE_CONFIDENCE.medium,
      reasonCodes: [NEXT_MOVE_REASON.feasibilityUnknown],
    });
  }
  if (state.lowConfidence) {
    return decision(state, NEXT_MOVE_RESULT.none, state.lowConfidence, {
      phase: 'choose',
      title: 'Choose the direction',
      confidence: NEXT_MOVE_CONFIDENCE.low,
      reasonCodes: [NEXT_MOVE_REASON.evidenceInsufficient],
    });
  }
  return decision(state, NEXT_MOVE_RESULT.none, null, {
    phase: 'none',
    title: 'No move needed',
    context: 'No session is waiting, no fixed commitment is active, and no intervention is justified.',
    reasonCodes: [NEXT_MOVE_REASON.noJustifiedMove],
    confidence: NEXT_MOVE_CONFIDENCE.high,
  });
}

export default chooseNextMove;
