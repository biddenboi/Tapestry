import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { GAME_STATE, STORES } from '@domain/constants.js';
import {
  buildTaskSessionSnapshot,
  pauseTaskSession,
  resumeTaskSession,
  taskSessionElapsed,
} from '@domain/tasks/TaskSessionClock.js';
import {
  repairLegacyMatchSessionAnchor,
  taskSessionRequestedAt,
  taskSessionRequestKey,
} from '@domain/tasks/TaskSessionLaunch.js';
import {
  ACTION_SESSION_OUTCOME,
  getActiveActionSession,
  pauseActionSession,
  resumeActionSession,
  settleActionSession,
  startActionSession,
} from '@domain/continuity/ActionSession.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { useInterval } from '@shared/hooks/useInterval.js';
import { completeTask } from '@features/tasks/domain/TaskCompletionService.js';
import { normalizeTaskDraft } from '@domain/tasks/TodoView.js';
import TaskSessionController from '@features/tasks/controllers/TaskSessionController.js';
import SessionResults from '@features/tasks/modals/SessionResults/SessionResults.jsx';
import { revealWorldConsequence } from '@domain/world-consequences/WorldConsequencePolicy.js';
import { finalizeMatchActionSessionScore } from '@domain/matches/MatchScoring.js';
import { calculateMatchPromiseScore } from '@domain/matches/MatchPromiseReward.js';
import { resolveRestorableMatchSession } from '@domain/matches/MatchSessionRecovery.js';
import { loadTaskSessionMenu } from '@features/tasks/loaders.js';
import {
  consumeTaskPlanReceipt,
  failTaskPlanReceipt,
  isTaskPlanReceiptValid,
} from '@domain/planning/TaskPlanReceipt.js';
import { requestLiveReferenceSync } from '@data/sync/ReferenceSyncLanes.js';

const TaskSessionContext = createContext(null);

function sourceForSession(gameState, task = {}) {
  if (gameState === GAME_STATE.match) return 'match';
  if (gameState === GAME_STATE.dojo) return 'shared';
  if (['arrival', 'handoff', 'planned', 'urgent', 'goal', 'recommended', 'reentry']
    .includes(task.continuitySource)) return 'arrival';
  if (task.taskRecommendationEventId || task.recommendation) return 'recommender';
  if (task.continuitySource === 'notification') return 'notification';
  return 'manual';
}

function localSessionFromRecord(record, task, sourceGameState, sourceDojoSessionUUID) {
  const startedAtMs = new Date(record.startedAt).getTime();
  const pausedAtMs = record.pausedAt ? new Date(record.pausedAt).getTime() : null;
  return {
    sessionId: record.UUID,
    actionSessionUUID: record.UUID,
    settlementOperationId: `task-session-settlement:${record.UUID}`,
    task: { ...task, actionSessionUUID: record.UUID },
    mode: 'expanded',
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
    committedMs: Math.max(0, Number(record.committedMs ?? task.sessionDuration) || 0),
    pausedAtMs: Number.isFinite(pausedAtMs) ? pausedAtMs : null,
    pausedTotalMs: Math.max(0, Number(record.pausedDurationMs) || 0),
    submittingAction: null,
    sourceGameState,
    sourceDojoSessionUUID,
    matchUUID: record.matchUUID || null,
    restoredFromContinuity: task.restoredFromContinuity === true,
    matchRewardContract: record.matchRewardContract || task.matchRewardContract || null,
    matchScoreFinalizedAt: record.matchScoreFinalizedAt || null,
    matchScoreEventUUID: record.matchScoreEventUUID || null,
    matchScoreBreakdown: record.matchScoreBreakdown || null,
    recordUpdatedAt: record.updatedAt || record.startedAt || null,
    canMinimize: sourceGameState !== GAME_STATE.dojo && !sourceDojoSessionUUID,
    settlementError: null,
  };
}

function activeTaskFromRecord(record, todo = null) {
  return {
    ...(todo || {}),
    UUID: record.targetUUID,
    name: todo?.name || record.targetName || 'Unfinished action',
    projectId: todo?.projectId || record.goalUUID || null,
    createdAt: record.startedAt,
    sessionRequestedAt: record.startedAt,
    sessionDuration: record.committedMs || 0,
    actionSessionUUID: record.UUID,
    dojoSessionUUID: record.dojoSessionUUID || null,
    continuitySource: record.source,
    restoredFromContinuity: true,
  };
}

export function TaskSessionProvider({ children }) {
  const {
    databaseConnection,
    domainRevisions,
    invalidateDomains,
    emitRewardEvent,
    playSound,
    currentPlayer,
    currentPlayerLoaded,
    ensureDomainLoaded,
    gameState: [gameState, setGameState],
    activeMatch: [activeMatch, setActiveMatch],
    activeTask: [activeTask, setActiveTask],
    replacePanel,
    dojoSessionUUID,
  } = useAppContext();
  const controller = useMemo(() => new TaskSessionController({ completeTask }), []);
  const [session, setSession] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now);
  const sessionRef = useRef(null);
  const expandedSurfaceRef = useRef(null);
  const restoreAttemptRef = useRef(null);
  const recoveredMatchSurfaceRef = useRef(null);
  const automaticSurfaceSessionRef = useRef(null);
  const activeSessionKey = taskSessionRequestKey(activeTask);

  const replaceSession = useCallback((next) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const updateSession = useCallback((updater) => {
    setSession((previous) => {
      const next = typeof updater === 'function' ? updater(previous) : updater;
      sessionRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!currentPlayerLoaded || !currentPlayer?.UUID || activeSessionKey) return;
    if (restoreAttemptRef.current) return;
    const attemptKey = `${currentPlayer.UUID}:${Date.now()}`;
    restoreAttemptRef.current = attemptKey;
    let cancelled = false;
    ensureDomainLoaded(['tasks', 'matches'])
      .then(() => getActiveActionSession(databaseConnection, currentPlayer.UUID))
      .then(async (record) => {
        if (!record || cancelled) return;
        const [todo, restorableMatch] = await Promise.all([
          databaseConnection.get(STORES.todo, record.targetUUID),
          resolveRestorableMatchSession(databaseConnection, {
            actionSession: record,
            playerUUID: currentPlayer.UUID,
          }),
        ]);
        if (cancelled) return;
        if (restorableMatch) {
          setActiveMatch(restorableMatch);
          setGameState(GAME_STATE.match);
          replacePanel(null);
        }
        const repairedRecord = repairLegacyMatchSessionAnchor(record, todo, Date.now());
        if (repairedRecord !== record) {
          await databaseConnection.add(STORES.actionSession, repairedRecord);
        }
        if (cancelled) return;
        setActiveTask(activeTaskFromRecord(repairedRecord, todo));
      })
      .catch((error) => console.warn('[TaskSessionProvider] session restore failed:', error))
      .finally(() => {
        if (restoreAttemptRef.current === attemptKey) restoreAttemptRef.current = null;
      });
    return () => { cancelled = true; };
  }, [
    activeSessionKey,
    currentPlayer?.UUID,
    currentPlayerLoaded,
    databaseConnection,
    domainRevisions.tasks,
    ensureDomainLoaded,
    replacePanel,
    setActiveMatch,
    setActiveTask,
    setGameState,
  ]);

  useEffect(() => {
    if (!activeSessionKey) {
      if (!sessionRef.current?.submittingAction) replaceSession(null);
      return undefined;
    }
    if (sessionRef.current?.sessionId === activeSessionKey) return undefined;
    let cancelled = false;
    const restoredDojoSessionUUID = activeTask.restoredFromContinuity
      ? activeTask.dojoSessionUUID || null
      : null;
    const requestedSourceGameState = restoredDojoSessionUUID ? GAME_STATE.dojo : gameState;
    const requestedDojoSessionUUID = requestedSourceGameState === GAME_STATE.dojo
      ? restoredDojoSessionUUID || dojoSessionUUID
      : null;
    const hydrate = async () => {
      const parent = currentPlayer?.UUID ? currentPlayer : await databaseConnection.getCurrentPlayer();
      if (!parent?.UUID) return;
      let record = activeTask.actionSessionUUID
        ? await databaseConnection.get(STORES.actionSession, activeTask.actionSessionUUID)
        : null;
      if (!record) {
        // Pull the live session set immediately before claiming a task. This
        // closes the ordinary desktop/phone race without waiting for the next
        // polling interval. The server mirror resolves a true simultaneous
        // race deterministically and the losing client follows that record.
        await requestLiveReferenceSync(databaseConnection, 'action-session-start-preflight')
          .catch(() => undefined);
        const existing = await getActiveActionSession(databaseConnection, parent.UUID);
        if (existing && String(existing.targetUUID) !== String(activeTask.UUID)) {
          const existingTodo = await databaseConnection.get(STORES.todo, existing.targetUUID);
          if (!cancelled) setActiveTask(activeTaskFromRecord(existing, existingTodo));
          return;
        }
        record = existing || await startActionSession(databaseConnection, {
            playerUUID: parent.UUID,
            task: activeTask,
            matchUUID: requestedSourceGameState === GAME_STATE.match ? activeMatch?.UUID || null : null,
            dojoSessionUUID: requestedDojoSessionUUID,
            source: sourceForSession(requestedSourceGameState, activeTask),
            startedAt: taskSessionRequestedAt(activeTask),
          });
      }
      if (!record || cancelled) return;
      if (!activeTask.actionSessionUUID) {
        setActiveTask((previous) => ({
          ...previous,
          actionSessionUUID: record.UUID,
        }));
      }
      const durableSourceGameState = record.matchUUID || record.source === 'match'
        ? GAME_STATE.match
        : record.dojoSessionUUID || record.source === 'shared'
          ? GAME_STATE.dojo
          : requestedSourceGameState;
      const durableDojoSessionUUID = durableSourceGameState === GAME_STATE.dojo
        ? record.dojoSessionUUID || requestedDojoSessionUUID
        : null;
      replaceSession(localSessionFromRecord(
        record,
        activeTask,
        durableSourceGameState,
        durableDojoSessionUUID,
      ));
      setNowMs(Date.now());
      void requestLiveReferenceSync(databaseConnection, 'action-session-started');
    };
    hydrate().catch((error) => {
      console.warn('[TaskSessionProvider] durable session start failed:', error);
      updateSession((current) => current ? { ...current, settlementError: error.message } : current);
    });
    return () => { cancelled = true; };
  }, [
    activeMatch?.UUID,
    activeSessionKey,
    activeTask,
    currentPlayer,
    databaseConnection,
    dojoSessionUUID,
    gameState,
    replaceSession,
    setActiveTask,
    updateSession,
  ]);

  useEffect(() => {
    const current = sessionRef.current;
    if (!current?.actionSessionUUID) return undefined;
    let cancelled = false;
    databaseConnection.get(STORES.actionSession, current.actionSessionUUID)
      .then((record) => {
        if (
          cancelled
          || !record
        ) return;
        if (record.outcome !== ACTION_SESSION_OUTCOME.active) {
          expandedSurfaceRef.current?.close?.();
          automaticSurfaceSessionRef.current = null;
          replaceSession(null);
          setActiveTask({});
          return;
        }
        if (String(record.updatedAt || record.startedAt || '') === String(current.recordUpdatedAt || '')) return;
        const refreshed = localSessionFromRecord(
          record,
          current.task,
          current.sourceGameState,
          current.sourceDojoSessionUUID,
        );
        replaceSession({
          ...refreshed,
          mode: current.mode,
          submittingAction: current.submittingAction,
          restoredFromContinuity: current.restoredFromContinuity,
        });
        setActiveTask((previous) => ({ ...previous, presencePaused: Boolean(record.pausedAt) }));
        setNowMs(Date.now());
      })
      .catch((error) => console.warn('[TaskSessionProvider] live session refresh failed:', error));
    return () => { cancelled = true; };
  }, [databaseConnection, domainRevisions.tasks, replaceSession, setActiveTask]);

  useEffect(() => {
    if (
      !session?.restoredFromContinuity
      || session.sourceGameState === GAME_STATE.match
      || automaticSurfaceSessionRef.current === session.sessionId
      || expandedSurfaceRef.current
    ) return undefined;
    let cancelled = false;
    loadTaskSessionMenu()
      .then((TaskSessionMenu) => {
        if (cancelled) return;
        automaticSurfaceSessionRef.current = session.sessionId;
        updateSession((current) => current?.sessionId === session.sessionId
          ? { ...current, mode: 'expanded' }
          : current);
        requestAnimationFrame(() => {
          NiceModal.show(TaskSessionMenu).catch((error) => {
            automaticSurfaceSessionRef.current = null;
            console.warn('[TaskSessionProvider] synchronized task surface failed:', error);
          });
        });
      })
      .catch((error) => console.warn('[TaskSessionProvider] synchronized task menu load failed:', error));
    return () => { cancelled = true; };
  }, [session?.restoredFromContinuity, session?.sessionId, session?.sourceGameState, updateSession]);

  useEffect(() => {
    const current = session;
    if (
      !currentPlayer?.UUID
      || current?.sourceGameState !== GAME_STATE.match
      || !current.matchUUID
    ) return undefined;
    const lostMatchSurface = gameState !== GAME_STATE.match
      || String(activeMatch?.UUID || '') !== String(current.matchUUID);
    const needsContinuitySurface = current.restoredFromContinuity
      && recoveredMatchSurfaceRef.current !== current.sessionId;
    if (!lostMatchSurface && !needsContinuitySurface) return undefined;

    let cancelled = false;
    ensureDomainLoaded(['matches', 'tasks'])
      .then(async () => {
        const actionSession = await databaseConnection.get(
          STORES.actionSession,
          current.actionSessionUUID,
        );
        const restorableMatch = await resolveRestorableMatchSession(databaseConnection, {
          actionSession,
          playerUUID: currentPlayer.UUID,
        });
        if (!restorableMatch || cancelled) return;
        const TaskSessionMenu = await loadTaskSessionMenu();
        if (cancelled) return;

        setActiveMatch(restorableMatch);
        setGameState(GAME_STATE.match);
        replacePanel(null);
        updateSession((latest) => latest?.sessionId === current.sessionId
          ? { ...latest, mode: 'expanded', settlementError: null }
          : latest);
        recoveredMatchSurfaceRef.current = current.sessionId;
        requestAnimationFrame(() => {
          NiceModal.show(TaskSessionMenu).catch((error) => {
            console.warn('[TaskSessionProvider] recovered Match session surface failed:', error);
          });
        });
      })
      .catch((error) => console.warn('[TaskSessionProvider] Match focus recovery failed:', error));
    return () => { cancelled = true; };
  }, [
    activeMatch?.UUID,
    currentPlayer?.UUID,
    databaseConnection,
    ensureDomainLoaded,
    gameState,
    replacePanel,
    session,
    setActiveMatch,
    setGameState,
    updateSession,
  ]);

  useInterval(
    () => setNowMs(Date.now()),
    session && session.pausedAtMs == null ? 1000 : null,
  );

  const snapshot = useMemo(() => {
    const base = buildTaskSessionSnapshot(session, nowMs);
    if (!base || !session?.matchRewardContract) return base;
    return {
      ...base,
      matchPromiseScore: session.matchScoreBreakdown || calculateMatchPromiseScore({
        contract: session.matchRewardContract,
        activeDurationMs: base.elapsedMs,
        boundaryAt: new Date(nowMs),
      }),
    };
  }, [nowMs, session]);
  const bindExpandedSurface = useCallback((surface) => {
    expandedSurfaceRef.current = surface;
    return () => {
      if (expandedSurfaceRef.current === surface) expandedSurfaceRef.current = null;
    };
  }, []);

  const setMode = useCallback((mode) => {
    if (!['expanded', 'docked'].includes(mode)) return;
    updateSession((current) => current && !current.submittingAction
      ? {
          ...current,
          mode: mode === 'docked' && !current.canMinimize ? 'expanded' : mode,
          settlementError: null,
        }
      : current);
  }, [updateSession]);

  const togglePause = useCallback(() => {
    const current = sessionRef.current;
    if (!current || current.submittingAction) return;
    const atMs = Date.now();
    const pausing = current.pausedAtMs == null;
    const next = pausing
      ? pauseTaskSession(current, atMs)
      : resumeTaskSession(current, atMs);
    replaceSession(next);
    setNowMs(atMs);
    setActiveTask((previous) => ({ ...previous, presencePaused: pausing }));
    const durableCommand = pausing
      ? pauseActionSession(databaseConnection, current.actionSessionUUID, new Date(atMs))
      : resumeActionSession(databaseConnection, current.actionSessionUUID, new Date(atMs));
    durableCommand
      .then(() => requestLiveReferenceSync(
        databaseConnection,
        pausing ? 'action-session-paused' : 'action-session-resumed',
      ))
      .catch((error) => {
        console.warn(`[TaskSessionProvider] durable ${pausing ? 'pause' : 'resume'} failed:`, error);
      });
    const presenceCommand = {
      playerId: currentPlayer?.UUID,
      viewerIGT: getCurrentIGT(currentPlayer, atMs),
      commandId: `task-presence-${pausing ? 'pause' : 'resume'}:${current.sessionId}:${atMs}`,
      at: new Date(atMs),
    };
    const command = pausing
      ? databaseConnection.pauseSocialWorldPresence(presenceCommand)
      : databaseConnection.resumeSocialWorldPresence(presenceCommand);
    command.then((result) => {
      if (result?.invalidatedDomains?.length) {
        invalidateDomains(DOMAIN_INVALIDATION.presenceWrite);
      }
    }).catch((error) => console.warn(
      `[TaskSessionProvider] presence ${pausing ? 'pause' : 'resume'} failed:`,
      error,
    ));
  }, [currentPlayer, databaseConnection, invalidateDomains, replaceSession, setActiveTask]);

  const finalizeMatchBoundary = useCallback(async (match, boundaryAt = new Date()) => {
    const current = sessionRef.current;
    if (
      !current
      || !match?.UUID
      || current.sourceGameState !== GAME_STATE.match
      || current.matchScoreFinalizedAt
      || String(current.task?.parent || currentPlayer?.UUID || '') !== String(currentPlayer?.UUID || '')
    ) return null;
    const persisted = await databaseConnection.get(STORES.actionSession, current.actionSessionUUID);
    if (!persisted || String(persisted.matchUUID || '') !== String(match.UUID)) return null;
    const boundaryDate = boundaryAt instanceof Date ? boundaryAt : new Date(boundaryAt);
    const boundaryMs = Number.isFinite(boundaryDate.getTime()) ? boundaryDate.getTime() : Date.now();
    const finalized = await finalizeMatchActionSessionScore(databaseConnection, {
      match,
      participantUUID: currentPlayer.UUID,
      actionSession: {
        ...persisted,
        matchRewardContract: persisted.matchRewardContract || current.matchRewardContract || null,
      },
      activeDurationMs: taskSessionElapsed(current, boundaryMs),
      boundaryAt: new Date(boundaryMs).toISOString(),
    });
    if (finalized?.actionSession) {
      updateSession((latest) => latest?.actionSessionUUID === current.actionSessionUUID
        ? {
            ...latest,
            matchScoreFinalizedAt: finalized.actionSession.matchScoreFinalizedAt,
            matchScoreEventUUID: finalized.actionSession.matchScoreEventUUID,
            matchScoreBreakdown: finalized.scoreBreakdown,
          }
        : latest);
      invalidateDomains(DOMAIN_INVALIDATION.matchWrite);
    }
    return finalized;
  }, [currentPlayer, databaseConnection, invalidateDomains, updateSession]);

  const settleSession = useCallback(async ({
    outcome = ACTION_SESSION_OUTCOME.progressed,
    blockerType = null,
    nextStep = null,
    outcomeNote = null,
  } = {}) => {
    const current = sessionRef.current;
    if (!current || current.submittingAction) return null;
    replaceSession({ ...current, submittingAction: outcome, settlementError: null });
    const endedAtMs = Date.now();
    const loggedDurationMs = taskSessionElapsed(current, endedAtMs);
    try {
      const parent = currentPlayer?.UUID ? currentPlayer : await databaseConnection.getCurrentPlayer();
      if (!parent?.UUID) throw new Error('No active player is available for this session.');
      let primaryTaskResult = null;
      if (outcome === ACTION_SESSION_OUTCOME.completed) {
        primaryTaskResult = await controller.settle({
          operationId: current.settlementOperationId,
          command: {
            databaseConnection,
            task: current.task,
            player: parent,
            gameState: current.sourceGameState,
            dojoSessionUUID: current.sourceDojoSessionUUID,
            source: current.sourceGameState,
            completionMode: 'timed',
            startedAt: current.task.createdAt,
            committedMs: current.committedMs,
            actualDurationMs: loggedDurationMs,
            removeTodo: true,
            emitRewardEvent,
            playSound,
            actionSessionUUID: current.actionSessionUUID,
          },
        });
        if (!primaryTaskResult) throw new Error('The completed task could not be settled.');
      }
      const settled = await settleActionSession(databaseConnection, {
        sessionUUID: current.actionSessionUUID,
        player: primaryTaskResult?.updatedPlayer || parent,
        outcome,
        blockerType,
        nextStep,
        outcomeNote,
        endedAt: new Date(endedAtMs),
        activeDurationMs: loggedDurationMs,
        primaryTaskResult,
        match: current.sourceGameState === GAME_STATE.match ? activeMatch : null,
      });
      const taskUUID = current.task?.UUID || current.task?.todoUUID || current.task?.targetUUID;
      if (taskUUID && currentPlayer?.UUID) {
        const receipts = await databaseConnection.getPlayerStore(
          STORES.taskPlanReceipt,
          currentPlayer.UUID,
        ).catch(() => []);
        const activeReceipt = receipts.find((receipt) => (
          receipt.status === 'active'
          && String(receipt.taskUUID) === String(taskUUID)
          && isTaskPlanReceiptValid(receipt, current.task)
        ));
        if (activeReceipt && outcome === ACTION_SESSION_OUTCOME.completed) {
          await databaseConnection.add(
            STORES.taskPlanReceipt,
            consumeTaskPlanReceipt(activeReceipt),
          );
        } else if (
          activeReceipt
          && outcome === ACTION_SESSION_OUTCOME.blocked
          && ['unclear', 'ambiguity', 'missing-step', 'changed-scope', 'approach-choice'].includes(blockerType)
        ) {
          const todo = await databaseConnection.get(STORES.todo, taskUUID);
          if (todo) {
            const failed = failTaskPlanReceipt(activeReceipt, todo);
            if (typeof databaseConnection.commitAtomicMutation === 'function') {
              await databaseConnection.commitAtomicMutation({
                label: `task-plan-failed:${taskUUID}`,
                puts: [
                  { store: STORES.taskPlanReceipt, record: failed.receipt },
                  { store: STORES.todo, record: failed.task },
                ],
              });
            } else {
              await databaseConnection.add(STORES.taskPlanReceipt, failed.receipt);
              await databaseConnection.add(STORES.todo, failed.task);
            }
          }
        }
      }
      let editTaskDraft = null;
      if ([ACTION_SESSION_OUTCOME.progressed, ACTION_SESSION_OUTCOME.blocked].includes(outcome) && taskUUID) {
        const remainingTodo = await databaseConnection.get(STORES.todo, taskUUID);
        if (remainingTodo) {
          const normalized = normalizeTaskDraft(remainingTodo);
          editTaskDraft = {
            ...normalized,
            todoCreatedAt: normalized.createdAt || null,
            createdAt: null,
            sessionRequestedAt: null,
            actionSessionUUID: null,
            originalDuration: Number(normalized.estimatedDuration || 0),
          };
        }
      }
      if (!primaryTaskResult) {
        emitRewardEvent?.([
          settled.points > 0 ? { amount: settled.points, unit: 'points', kind: 'points' } : null,
          settled.coins > 0 ? { amount: settled.coins, unit: 'coins', kind: 'coins' } : null,
          settled.contribution > 0
            ? { amount: settled.contribution, unit: 'contribution', kind: 'contribution' }
            : null,
        ].filter(Boolean), { source: 'task-results', actionSessionUUID: current.actionSessionUUID });
      }
      let revealedWorldReceipt = null;
      if (settled.worldReceipt) {
        revealedWorldReceipt = await revealWorldConsequence(
          databaseConnection,
          settled.worldReceipt.UUID,
        ).catch((error) => {
          console.warn('[TaskSessionProvider] world receipt reveal failed:', error);
          return null;
        });
      }
      await databaseConnection.closeCompletedTaskSessionPresence({
        playerId: parent.UUID,
        viewerIGT: getCurrentIGT(parent),
        commandId: `task-presence-close:${current.actionSessionUUID}:${outcome}`,
      }).then((presenceResult) => {
        if (presenceResult?.invalidatedDomains?.length) {
          invalidateDomains(DOMAIN_INVALIDATION.presenceWrite);
        }
      }).catch((error) => console.warn('[TaskSessionProvider] presence close failed:', error));
      setActiveTask(editTaskDraft || {});
      expandedSurfaceRef.current?.close?.();
      replaceSession(null);
      requestAnimationFrame(() => {
        invalidateDomains(DOMAIN_INVALIDATION.taskWrite);
        NiceModal.show(SessionResults, {
          duration: settled.session.activeDurationMs,
          points: settled.points,
          tokens: settled.coins,
          reward: settled.reward,
          taskName: settled.session.targetName,
          outcome,
          nextStep: settled.session.nextStep,
          blockerType: settled.session.blockerType,
          integration: revealedWorldReceipt ? {
            ...settled.integration,
            world: {
              ...settled.integration.world,
              revealedAt: revealedWorldReceipt.revealedAt,
            },
          } : settled.integration,
          matchScoreBreakdown: settled.scoreEvent?.evidence?.matchReward
            || settled.session.matchScoreBreakdown
            || null,
          provenance: settled.provenance,
          showTaskCreation: Boolean(editTaskDraft),
        });
      });
      return settled;
    } catch (error) {
      console.warn('[TaskSessionProvider] session settlement failed:', error);
      updateSession((latest) => latest?.sessionId === current.sessionId
        ? { ...latest, submittingAction: null, settlementError: error.message || 'Session could not close.' }
        : latest);
      return null;
    }
  }, [
    activeMatch,
    controller,
    currentPlayer,
    databaseConnection,
    emitRewardEvent,
    invalidateDomains,
    playSound,
    replaceSession,
    setActiveTask,
    updateSession,
  ]);

  const value = useMemo(() => ({
    snapshot,
    bindExpandedSurface,
    minimize: () => setMode('docked'),
    expand: () => setMode('expanded'),
    togglePause,
    settleSession,
    finalizeMatchBoundary,
  }), [
    bindExpandedSurface,
    setMode,
    settleSession,
    finalizeMatchBoundary,
    snapshot,
    togglePause,
  ]);

  return (
    <TaskSessionContext.Provider value={value}>
      {children}
    </TaskSessionContext.Provider>
  );
}

export function useTaskSession() {
  const context = useContext(TaskSessionContext);
  if (!context) throw new Error('useTaskSession must be used within TaskSessionProvider.');
  return context;
}

export default TaskSessionProvider;
