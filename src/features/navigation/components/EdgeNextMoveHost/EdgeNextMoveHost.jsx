import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAppContext } from '../../../../app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '../../../../app/context/domainRevisions.js';
import { GAME_STATE, STORES } from '../../../../domain/constants.js';
import { chooseNextMove } from '../../../../domain/navigation/NextMoveArbiter.js';
import { patchNextMoveDecision } from '../../../../domain/navigation/NextMoveDecision.js';
import { buildNextMoveState } from '../../../../domain/navigation/NextMoveStateBuilder.js';
import NextMoveDecisionRepository from '../../../../data/persistence/repositories/NextMoveDecisionRepository.js';
import NextMoveFeedbackRepository from '../../../../data/persistence/repositories/NextMoveFeedbackRepository.js';
import { useTaskSession } from '../../../tasks/context/TaskSessionProvider.jsx';
import { showTaskPreviewMenu } from '../../../tasks/modals/TaskPreviewMenu/loadTaskPreviewMenu.js';
import { followNavigationRoute } from '../../services/NavigationRouteService.js';
import { applyNextMoveFeedback } from '../../services/SuggestionFeedbackService.js';
import {
  clearWorldRoute,
  showWorldRoute,
} from '../../services/WorldRouteHighlightService.js';
import NextMoveDrawer from '../NextMoveDrawer/NextMoveDrawer.jsx';
import useDraggableNextMove from './useDraggableNextMove.js';
import useEdgeReveal from './useEdgeReveal.js';
import useNextMovePlacement from './useNextMovePlacement.js';
import './EdgeNextMoveHost.css';

function activeTaskCandidate(snapshot) {
  if (!snapshot?.task) return null;
  return {
    UUID: snapshot.task.UUID || snapshot.task.actionSessionUUID,
    entityUUID: snapshot.task.UUID,
    entityType: 'task',
    title: snapshot.task.name || 'Current task',
    context: 'Keep control of the work already in progress.',
    routeLabel: `Tasks → ${snapshot.task.name || 'current task'}`,
    invalidationKeys: [`action-session:${snapshot.actionSessionUUID || snapshot.sessionId}`],
  };
}

export default function EdgeNextMoveHost() {
  const {
    databaseConnection,
    currentPlayer,
    currentPlayerLoaded,
    domainRevisions,
    ensureDomainLoaded,
    invalidateDomains,
    activeTask: [, setActiveTask],
    activeMatch: [activeMatch],
    gameState: [gameState],
    dojoSessionUUID,
    openRoute,
    setWorldRoute,
  } = useAppContext();
  const taskSession = useTaskSession();
  const panelRef = useRef(null);
  const stateRef = useRef(null);
  const evaluationGenerationRef = useRef(0);
  const previousSessionUUIDRef = useRef(null);
  const explicitlyOpenedRef = useRef(false);
  const [surface, setSurface] = useState('closed');
  const [decision, setDecision] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clarificationTask, setClarificationTask] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const [requestVersion, setRequestVersion] = useState(0);
  const playerUUID = currentPlayer?.UUID || null;
  const activeSessionUUID = taskSession.snapshot?.actionSessionUUID
    || taskSession.snapshot?.sessionId
    || null;
  const dockedTaskSession = taskSession.snapshot?.mode === 'docked'
    && Boolean(taskSession.snapshot?.task)
    && Boolean(activeSessionUUID);
  const open = surface !== 'closed';
  const openRecommendation = useCallback(() => {
    explicitlyOpenedRef.current = true;
    evaluationGenerationRef.current += 1;
    setDecision(null);
    setLoading(false);
    setError('');
    setClarificationTask(null);
    clearWorldRoute(setWorldRoute);
    if (dockedTaskSession) {
      setSurface('active-session');
      return;
    }
    setSurface('recommendation');
    setRequestVersion((version) => version + 1);
  }, [dockedTaskSession, setWorldRoute]);
  const decisionRepository = useMemo(
    () => databaseConnection ? new NextMoveDecisionRepository(databaseConnection) : null,
    [databaseConnection],
  );
  const feedbackRepository = useMemo(
    () => databaseConnection ? new NextMoveFeedbackRepository(databaseConnection) : null,
    [databaseConnection],
  );
  const {
    placement,
    pixels,
    moveByCommand,
    commitPixels,
  } = useNextMovePlacement({
    databaseConnection,
    playerUUID,
    panelRef,
    onAnnouncement: setAnnouncement,
  });
  const draggable = useDraggableNextMove({
    panelRef,
    position: pixels,
    width: pixels.width,
    onCommit: commitPixels,
    onKeyboardCommit: ({ x, y }) => commitPixels({ x, y }),
  });
  const edgeReveal = useEdgeReveal({
    edge: placement.dockEdge || 'right',
    open,
    onOpen: openRecommendation,
  });

  const evaluate = useCallback(async (decisionPoint = 'drawer-open') => {
    if (!currentPlayerLoaded || !playerUUID) return null;
    const generation = ++evaluationGenerationRef.current;
    setLoading(true);
    setError('');
    setClarificationTask(null);
    try {
      await ensureDomainLoaded?.('nextMove');
      const state = await buildNextMoveState({
        databaseConnection,
        currentPlayer,
        decisionPoint,
        activeTaskSession: taskSession.snapshot
          ? activeTaskCandidate(taskSession.snapshot)
          : null,
        activePairMatch: gameState === GAME_STATE.match && activeMatch
          ? {
              UUID: activeMatch.UUID,
              title: 'Pair Match in progress',
              context: 'The active Match dock owns the current move.',
              worldLocationId: 'match-arena',
              invalidationKeys: [`match:${activeMatch.UUID}:${activeMatch.status}:${activeMatch.phase}`],
            }
          : null,
        activeDojoSession: gameState === GAME_STATE.dojo && dojoSessionUUID
          ? {
              UUID: dojoSessionUUID,
              title: 'Dojo session in progress',
              context: 'The active Dojo surface owns the current move.',
              worldLocationId: 'dojo',
              invalidationKeys: [`dojo:${dojoSessionUUID}`],
            }
          : null,
      });
      stateRef.current = state;
      const next = chooseNextMove(state);
      const shownAt = new Date().toISOString();
      const shown = patchNextMoveDecision(next, { shownAt });
      await decisionRepository.save(shown);
      if (generation !== evaluationGenerationRef.current) return null;
      setDecision(shown);
      showWorldRoute(setWorldRoute, shown.destination);
      return shown;
    } catch (nextError) {
      if (generation !== evaluationGenerationRef.current) return null;
      console.warn('[NextMove] decision failed:', nextError);
      setError(nextError.message || 'Next Move could not evaluate the current state.');
      return null;
    } finally {
      if (generation === evaluationGenerationRef.current) setLoading(false);
    }
  }, [
    activeMatch,
    currentPlayer,
    currentPlayerLoaded,
    databaseConnection,
    decisionRepository,
    dojoSessionUUID,
    ensureDomainLoaded,
    gameState,
    playerUUID,
    setWorldRoute,
    taskSession.snapshot,
  ]);

  useEffect(() => {
    if (surface !== 'recommendation' || !requestVersion || dockedTaskSession) return;
    evaluate('drawer-open');
  }, [dockedTaskSession, evaluate, requestVersion, surface]);

  useEffect(() => {
    const previousSessionUUID = previousSessionUUIDRef.current;
    previousSessionUUIDRef.current = activeSessionUUID;

    if (dockedTaskSession) {
      // A mode change keeps the same action-session UUID. The session surface
      // owns the drawer until that durable session is settled or expanded.
      evaluationGenerationRef.current += 1;
      setLoading(false);
      setError('');
      setDecision(null);
      setClarificationTask(null);
      setSurface('active-session');
      return;
    }

    if (previousSessionUUID && !activeSessionUUID) {
      if (explicitlyOpenedRef.current) {
        setDecision(null);
        setError('');
        setClarificationTask(null);
        setSurface('recommendation');
        setRequestVersion((version) => version + 1);
      } else {
        setSurface('closed');
      }
      return;
    }

    if (activeSessionUUID) setSurface('closed');
  }, [activeSessionUUID, dockedTaskSession]);

  useEffect(() => {
    const openFromCommand = () => openRecommendation();
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        openFromCommand();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('tapestry:open-next-move', openFromCommand);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('tapestry:open-next-move', openFromCommand);
    };
  }, [openRecommendation]);

  useEffect(() => () => clearWorldRoute(setWorldRoute), [setWorldRoute]);

  const close = useCallback(() => {
    explicitlyOpenedRef.current = false;
    evaluationGenerationRef.current += 1;
    if (placement.mode === 'floating') {
      const nearestEdge = pixels.x + pixels.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
      commitPixels({ x: pixels.x, y: pixels.y, dockEdge: nearestEdge });
    }
    setSurface('closed');
    setLoading(false);
    setError('');
    setClarificationTask(null);
    clearWorldRoute(setWorldRoute);
  }, [commitPixels, pixels, placement.mode, setWorldRoute]);

  const markAccepted = useCallback(async () => {
    if (!decision) return decision;
    const acceptedAt = new Date().toISOString();
    const accepted = patchNextMoveDecision(decision, {
      acceptedAt,
      resultingActionStartedAt: acceptedAt,
      outcome: 'accepted',
    });
    await decisionRepository.save(accepted);
    setDecision(accepted);
    return accepted;
  }, [decision, decisionRepository]);

  const beginTask = useCallback(async (task, suggestedMinutes = null) => {
    if (!task) return;
    setActiveTask({
      ...task,
      todoCreatedAt: task.todoCreatedAt || task.createdAt || null,
      createdAt: null,
      sessionRequestedAt: null,
      originalDuration: Number(task.estimatedDuration || 0),
      ...(suggestedMinutes ? { sessionDuration: Number(suggestedMinutes) * 60 * 1000 } : {}),
      continuitySource: 'recommended',
    });
    close();
    requestAnimationFrame(() => {
      showTaskPreviewMenu().catch((nextError) => {
        console.warn('[NextMove] task preview could not open:', nextError);
      });
    });
  }, [close, setActiveTask]);

  const primary = useCallback(async () => {
    if (!decision) return;
    if (decision.resultType === 'clarify') {
      const task = await databaseConnection.get(STORES.todo, decision.destination?.entityUUID);
      if (task) setClarificationTask(task);
      return;
    }
    await markAccepted();
    if (decision.resultType === 'execute' || decision.resultType === 'continue') {
      const task = await databaseConnection.get(STORES.todo, decision.destination?.entityUUID);
      await beginTask(task, stateRef.current?.executableWork?.suggestedMinutes);
      return;
    }
    if (decision.resultType === 'recover') {
      close();
      return;
    }
    if (decision.destination) {
      followNavigationRoute(openRoute, decision.destination);
      close();
      return;
    }
    followNavigationRoute(openRoute, {
      panel: 'tasks',
      routeLabel: 'Tasks → choose manually',
      worldLocationId: 'tasks',
    });
    close();
  }, [
    beginTask,
    close,
    databaseConnection,
    decision,
    markAccepted,
    openRoute,
  ]);

  const correct = useCallback(async (type) => {
    if (!decision || !playerUUID) return;
    await applyNextMoveFeedback({
      databaseConnection,
      decisionRepository,
      feedbackRepository,
      decision,
      playerUUID,
      type,
    });
    invalidateDomains(DOMAIN_INVALIDATION.nextMoveWrite);
    if (type === 'need-plan') {
      const taskUUID = decision.destination?.entityUUID;
      const task = taskUUID ? await databaseConnection.get(STORES.todo, taskUUID) : null;
      if (task) setClarificationTask({ ...task, planEligible: true, needsPlanning: true });
      return;
    }
    if (type === 'not-now') return;
    if (type === 'manual-choice') {
      followNavigationRoute(openRoute, {
        panel: 'tasks',
        routeLabel: 'Tasks → choose manually',
        worldLocationId: 'tasks',
      });
      close();
      return;
    }
    if (['already-handled', 'wrong-context'].includes(type) && decision.destination) {
      followNavigationRoute(openRoute, {
        ...decision.destination,
        subview: type === 'wrong-context' ? 'edit' : decision.destination.subview,
        focusTarget: type === 'wrong-context' ? 'deadline' : decision.destination.focusTarget,
      });
      close();
      return;
    }
    setRequestVersion((version) => version + 1);
  }, [
    close,
    databaseConnection,
    decision,
    decisionRepository,
    feedbackRepository,
    invalidateDomains,
    openRoute,
    playerUUID,
  ]);

  const chooseAlternative = useCallback((alternative) => {
    if (!alternative?.destination) return;
    followNavigationRoute(openRoute, alternative.destination);
    close();
  }, [close, openRoute]);

  const manual = useCallback(() => {
    followNavigationRoute(openRoute, {
      panel: 'tasks',
      routeLabel: 'Tasks → choose manually',
      worldLocationId: 'tasks',
    });
    close();
  }, [close, openRoute]);

  const notNow = useCallback(async () => {
    await correct('not-now');
    close();
  }, [close, correct]);

  const style = {
    left: `${pixels.x}px`,
    top: `${pixels.y}px`,
    width: `${pixels.width}px`,
    ...draggable.style,
  };
  const activeTaskSurface = surface === 'active-session' && dockedTaskSession
    ? taskSession.snapshot
    : null;
  const hiddenForFocusSurface = gameState !== GAME_STATE.idle && !activeTaskSurface;

  return (
    <div
      className={[
        'edge-next-move-host',
        placement.mode === 'docked' ? `is-docked is-docked-${placement.dockEdge || 'right'}` : 'is-floating',
        open ? 'is-open' : 'is-hidden',
      ].join(' ')}
      data-next-move-host
    >
      {!hiddenForFocusSurface && (
        <>
          <div
            className={`next-move-edge-zone next-move-edge-zone--${placement.dockEdge || 'right'}`}
            aria-hidden="true"
            {...edgeReveal.edgeProps}
          />
          {edgeReveal.lipVisible && (
            <button
              type="button"
              className={`next-move-lip next-move-lip--${placement.dockEdge || 'right'}`}
              aria-label="Open Next Move"
              {...edgeReveal.lipProps}
            >
              <span>Next Move</span>
            </button>
          )}
          <button
            type="button"
            className="next-move-access-command"
            onClick={openRecommendation}
          >
            Open Next Move
          </button>
          {open && (
            <div ref={panelRef} className="next-move-positioner" style={style}>
              <NextMoveDrawer
                decision={decision}
                loading={loading}
                error={error}
                grabProps={draggable.grabProps}
                dragging={draggable.dragging}
                keyboardMode={draggable.keyboardMode}
                snapEdge={draggable.snapEdge}
                onClose={close}
                onPrimary={primary}
                onNotNow={notNow}
                onCorrection={correct}
                onAlternative={chooseAlternative}
                onManual={manual}
                onPlace={moveByCommand}
                onStartKeyboardMove={draggable.startKeyboardMove}
                activeTask={activeTaskSurface}
                taskSession={taskSession}
                onRetry={openRecommendation}
                clarificationTask={clarificationTask}
                clarificationProps={{
                  databaseConnection,
                  playerUUID,
                  onCancel: () => setClarificationTask(null),
                  onSaved: async ({ task }) => {
                    invalidateDomains(DOMAIN_INVALIDATION.nextMoveWrite);
                    await markAccepted();
                    await beginTask(task);
                  },
                }}
              />
            </div>
          )}
          <div className="next-move-announcer" aria-live="polite">{announcement}</div>
        </>
      )}
    </div>
  );
}
