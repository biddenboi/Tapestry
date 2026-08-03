import '@features/tasks/modals/TaskPreviewMenu/TaskPreviewMenu.css';
import { useEffect, useMemo, useState } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { measureDynamicModule } from '@shared/performance/startupPerf.js';
import { GAME_STATE, MATCH_STATUS, STORES, MINUTE } from '@domain/constants.js';
import { deleteTaskCommand, saveTaskCommand } from '@domain/tasks/TaskCommands.js';
import { consumeActionPlan, saveActionPlan } from '@domain/continuity/ActionPlan.js';
import { getNormalizedActiveEffects } from '@domain/events/ActiveEffectsCache.js';
import {
  buildMatchPromiseContract,
  matchSupportsPromiseRewards,
} from '@domain/matches/MatchPromiseReward.js';
import MarkdownEditor from '@shared/markdown-editor/MarkdownEditor.jsx';

const loadTaskRecommender = () => measureDynamicModule('task-recommender', () => import('@domain/tasks/TaskRecommender.js'));
const loadTaskSessionMenu = () => measureDynamicModule('task-session-menu', () =>
  import('@features/tasks/modals/TaskSessionMenu/TaskSessionMenu.jsx')).then((module) => module.default);

function defaultPlanTime() {
  const date = new Date(Date.now() + 60 * MINUTE);
  date.setMinutes(0, 0, 0);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default NiceModal.create(() => {
  const {
    databaseConnection,
    invalidateDomains,
    currentPlayer,
    domainRevisions,
    gameState: [gameState],
    activeMatch: [activeMatch],
    activeTask: [activeTask, setActiveTask],
  } = useAppContext();
  const modal = useModal();
  const safeActiveTask = activeTask && typeof activeTask === 'object' ? activeTask : {};

  // An optional focus boundary is planning context, not a reward condition.
  const [sessionMinutes, setSessionMinutes] = useState(
    () => Math.round((Number(safeActiveTask.sessionDuration) || 0) / MINUTE),
  );
  const [pendingAction, setPendingAction] = useState(null);
  const [navigationError, setNavigationError] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [planAt, setPlanAt] = useState(defaultPlanTime);
  const [planCue, setPlanCue] = useState('');
  const [activeEffects, setActiveEffects] = useState([]);
  const [activeEffectsReady, setActiveEffectsReady] = useState(false);
  const isPromiseMatch = gameState === GAME_STATE.match
    && activeMatch?.status === MATCH_STATUS.active
    && matchSupportsPromiseRewards(activeMatch);

  useEffect(() => {
    let cancelled = false;
    if (!isPromiseMatch || !currentPlayer?.UUID) {
      setActiveEffects([]);
      setActiveEffectsReady(true);
      return undefined;
    }
    setActiveEffectsReady(false);
    getNormalizedActiveEffects(
      databaseConnection,
      currentPlayer.UUID,
      domainRevisions.eventBuffs,
    ).then((effects) => {
      if (!cancelled) {
        setActiveEffects(effects);
        setActiveEffectsReady(true);
      }
    }).catch((error) => {
      console.warn('[TaskPreviewMenu] Match effects could not be loaded:', error);
      if (!cancelled) {
        setActiveEffects([]);
        setActiveEffectsReady(true);
      }
    });
    return () => { cancelled = true; };
  }, [
    activeMatch?.UUID,
    currentPlayer?.UUID,
    databaseConnection,
    domainRevisions.eventBuffs,
    isPromiseMatch,
  ]);

  const promisePreview = useMemo(() => isPromiseMatch
    ? buildMatchPromiseContract({
        match: activeMatch,
        task: safeActiveTask,
        activeEffects,
        promisedMs: sessionMinutes * MINUTE,
        acceptedAt: new Date(),
      })
    : null, [activeEffects, activeMatch, isPromiseMatch, safeActiveTask, sessionMinutes]);
  const maximumPromiseMinutes = promisePreview
    ? Math.max(0, Math.floor(promisePreview.maximumPromiseMs / MINUTE))
    : null;
  const acceptedPromiseMinutes = promisePreview
    ? promisePreview.promisedMs / MINUTE
    : sessionMinutes;
  const promisePercentage = promisePreview?.matchDurationMs
    ? Math.round((promisePreview.promisedMs / promisePreview.matchDurationMs) * 100)
    : 0;
  useEffect(() => {
    if (!isPromiseMatch || maximumPromiseMinutes == null) return;
    setSessionMinutes((minutes) => Math.min(Math.max(0, minutes), maximumPromiseMinutes));
  }, [isPromiseMatch, maximumPromiseMinutes]);

  const close = () => {
    modal.hide();
    modal.remove();
  };

  const persistRecommendationNavigation = async (reason) => {
    if (!safeActiveTask.taskRecommendationEventId && !safeActiveTask.recommendation?.eventUUID) return;
    const { dismissRecommendationForTask } = await loadTaskRecommender();
    await dismissRecommendationForTask(databaseConnection, safeActiveTask, reason);
  };

  const canStart = () => Boolean(String(safeActiveTask.name ?? '').trim());

  const handleSliderChange = (e) => setSessionMinutes(Number(e.target.value));

  const handleMinutesInput = (e) => {
    const v = parseInt(e.target.value, 10);
    setSessionMinutes(Number.isFinite(v) && v >= 0 ? v : 0);
  };

  const startSession = async () => {
    if (pendingAction) return;
    if (isPromiseMatch && !activeEffectsReady) {
      setNavigationError('Loading the Match scoring rules. Try again in a moment.');
      return;
    }
    setPendingAction('start');
    setNavigationError('');
    try {
      const parent = currentPlayer?.UUID ? currentPlayer : await databaseConnection.getCurrentPlayer();
      const requestedCommittedMs = sessionMinutes * MINUTE;
      const sessionStartedAt = new Date().toISOString();
      const matchRewardContract = isPromiseMatch
        ? buildMatchPromiseContract({
            match: activeMatch,
            task: safeActiveTask,
            activeEffects,
            promisedMs: requestedCommittedMs,
            acceptedAt: sessionStartedAt,
          })
        : null;
      const committedMs = matchRewardContract?.promisedMs ?? requestedCommittedMs;
      const recommendationEventId = safeActiveTask.taskRecommendationEventId || safeActiveTask.recommendation?.eventUUID;
      if (recommendationEventId) {
        const { recordTaskRecommendationOutcome } = await loadTaskRecommender();
        await recordTaskRecommendationOutcome(databaseConnection, recommendationEventId, 'accepted', {
          reason: 'preview-session-started',
          suggestedMinutes: Number(safeActiveTask.recommendation?.suggestedMinutes || safeActiveTask.estimatedDuration || 0),
          acceptedMinutes: committedMs / MINUTE,
          committedMs,
        });
      }
      if (safeActiveTask.actionPlanUUID) {
        await consumeActionPlan(databaseConnection, safeActiveTask.actionPlanUUID);
      }
      const TaskSessionMenu = await loadTaskSessionMenu();
      // Session state changes only after the recommendation acceptance and
      // target modal are durable/available, so navigation cannot outrun them.
      setActiveTask((previous) => ({
        ...(previous || {}),
        createdAt: sessionStartedAt,
        sessionRequestedAt: sessionStartedAt,
        parent: parent?.UUID || previous.parent,
        UUID: previous.UUID || uuid(),
        estimatedDuration: Number(previous.estimatedDuration || 0),
        sessionDuration: committedMs,
        matchRewardContract,
      }));
      close();
      requestAnimationFrame(() => NiceModal.show(TaskSessionMenu));
    } catch (error) {
      console.warn('[TaskPreviewMenu] session start failed:', error);
      setNavigationError(error?.message || 'Session start could not be recorded. Please try again.');
      setPendingAction(null);
    }
  };

  const handleSavePlan = async () => {
    if (pendingAction || !canStart()) return;
    setPendingAction('plan');
    setNavigationError('');
    try {
      const parent = currentPlayer?.UUID ? currentPlayer : await databaseConnection.getCurrentPlayer();
      const targetUUID = safeActiveTask.UUID || uuid();
      const plannedStart = new Date(planAt);
      if (!Number.isFinite(plannedStart.getTime())) {
        throw new TypeError('Choose a valid date and time for this plan.');
      }
      const taskToSave = {
        ...safeActiveTask,
        UUID: targetUUID,
        parent: parent?.UUID || safeActiveTask.parent,
        createdAt: safeActiveTask.todoCreatedAt || safeActiveTask.createdAt || new Date().toISOString(),
        estimatedDuration: Number(safeActiveTask.estimatedDuration || 0),
      };
      delete taskToSave.todoCreatedAt;
      delete taskToSave.actionPlanUUID;
      await saveTaskCommand(databaseConnection, taskToSave);
      await saveActionPlan(databaseConnection, {
        playerUUID: parent?.UUID || taskToSave.parent,
        targetType: 'todo',
        targetUUID,
        triggerType: 'time',
        triggerValue: {
          cue: planCue.trim() || `At the planned time, surface “${taskToSave.name}”.`,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        },
        plannedWindowStart: plannedStart.toISOString(),
        plannedWindowEnd: new Date(
          plannedStart.getTime() + Math.max(30 * MINUTE, sessionMinutes * MINUTE),
        ).toISOString(),
      });
      await persistRecommendationNavigation('preview-action-planned');
      setActiveTask({});
      invalidateDomains(DOMAIN_INVALIDATION.taskWrite);
      close();
    } catch (error) {
      console.warn('[TaskPreviewMenu] action plan failed:', error);
      setNavigationError(error?.message || 'The action plan could not be saved. Please try again.');
      setPendingAction(null);
    }
  };

  const handleDeleteTask = async () => {
    if (pendingAction) return;
    setPendingAction('delete');
    setNavigationError('');
    try {
      await persistRecommendationNavigation('preview-task-deleted');
      if (safeActiveTask.UUID) {
        await deleteTaskCommand(databaseConnection, safeActiveTask);
        invalidateDomains(DOMAIN_INVALIDATION.taskWrite);
      }
      setActiveTask({});
      close();
    } catch (error) {
      console.warn('[TaskPreviewMenu] task deletion failed:', error);
      setNavigationError(error?.message || 'The task could not be deleted. Please try again.');
      setPendingAction(null);
    }
  };

  const handleSaveTodo = async () => {
    if (pendingAction) return;
    setPendingAction('back');
    setNavigationError('');
    try {
      await persistRecommendationNavigation('preview-returned-to-todo');
      const parent = currentPlayer?.UUID ? currentPlayer : await databaseConnection.getCurrentPlayer();
      const taskToSave = {
        ...safeActiveTask,
        UUID: safeActiveTask.UUID || uuid(),
        parent: parent?.UUID || safeActiveTask.parent,
        createdAt: safeActiveTask.todoCreatedAt || safeActiveTask.createdAt || new Date().toISOString(),
        estimatedDuration: Number(safeActiveTask.estimatedDuration || 0),
      };
      delete taskToSave.todoCreatedAt;
      await saveTaskCommand(databaseConnection, taskToSave);
      setActiveTask({});
      invalidateDomains(DOMAIN_INVALIDATION.taskWrite);
      close();
    } catch (error) {
      console.warn('[TaskPreviewMenu] return to Todo failed:', error);
      setNavigationError(error?.message || 'The Todo could not be saved. Please try again.');
      setPendingAction(null);
    }
  };

  const handleOverlayClose = async () => {
    if (pendingAction) return;
    setPendingAction('close');
    setNavigationError('');
    try {
      await persistRecommendationNavigation('preview-overlay-closed');
      close();
    } catch (error) {
      console.warn('[TaskPreviewMenu] preview close failed:', error);
      setNavigationError(error?.message || 'The preview close could not be recorded. Please try again.');
      setPendingAction(null);
    }
  };

  if (!modal.visible) return null;

  return (
    <div className="task-modal-overlay">
      <div
        className="blanker"
        onClick={handleOverlayClose}
      />
      <div className="task-modal">
        <div className="task-modal-header">
          <span>SESSION PREVIEW</span>
        </div>

        <div className="task-form-body">

          <label className="full-width">
            Task Name
            <input
              type="text"
              value={String(safeActiveTask.name ?? '')}
              onChange={(event) => setActiveTask((previous) => ({ ...(previous || {}), name: event.target.value }))}
            />
          </label>

          {/* ── Focus boundary / Match promise ─────────────── */}
          <div className="tcm-field-group">
            <span className="tcm-field-label">{isPromiseMatch ? 'Match Promise' : 'Optional Focus Boundary'}</span>
            <div className="preview-commitment-row">
              <input
                type="number"
                className="preview-minutes-input"
                min="0"
                value={sessionMinutes || ''}
                onChange={handleMinutesInput}
                placeholder="0"
              />
              <span className="preview-minutes-unit">MIN</span>
              <input
                type="range"
                className="range-input preview-commitment-slider"
                min="0"
                max={isPromiseMatch ? Math.max(1, maximumPromiseMinutes || 0) : 60}
                step="1"
                value={Math.min(sessionMinutes, isPromiseMatch ? Math.max(1, maximumPromiseMinutes || 0) : 60)}
                onChange={handleSliderChange}
              />
            </div>
            <div className="range-ticks">
              <span>0</span>
              <span>15</span>
              <span>30</span>
              <span>45</span>
              <span>60+</span>
            </div>
            {isPromiseMatch && promisePreview ? (
              <div className="match-promise-preview" aria-label="Match promise reward preview">
                <div>
                  <span>{Math.round(acceptedPromiseMinutes)}m · {promisePercentage}% of Match</span>
                  <strong>Match promise</strong>
                </div>
                <p>
                  Match scoring modifiers are concealed during competition.
                  Missing the promise removes only its duration bonus, not points already earned.
                </p>
                {sessionMinutes > maximumPromiseMinutes && (
                  <small>Promise capped at the {maximumPromiseMinutes}m remaining in this Match.</small>
                )}
              </div>
            ) : (
              <p className="preview-focus-note">
                This is an estimate, not a promise. You can pause or close with any honest outcome.
              </p>
            )}
          </div>

          <label className="full-width">
            Description
            <MarkdownEditor
              value={String(safeActiveTask.efficiency ?? safeActiveTask.description ?? '')}
              onChange={(value) => setActiveTask((previous) => ({ ...(previous || {}), efficiency: value }))}
              placeholder="No description yet — add one by editing this task."
              className="plan-editor"
            />
          </label>

          <section className="preview-plan-card" aria-label="Plan this action for later">
            <button
              type="button"
              className="preview-plan-card__toggle"
              onClick={() => setPlanOpen((value) => !value)}
              aria-expanded={planOpen}
            >
              <span>
                <strong>Plan for later</strong>
                <small>Create an optional cue when now is not the right window.</small>
              </span>
              <i aria-hidden="true">{planOpen ? '−' : '+'}</i>
            </button>
            {planOpen && (
              <div className="preview-plan-card__body">
                <label>
                  When should this return?
                  <input
                    type="datetime-local"
                    value={planAt}
                    onChange={(event) => setPlanAt(event.target.value)}
                  />
                </label>
                <label>
                  Context cue <span>optional</span>
                  <input
                    type="text"
                    value={planCue}
                    onChange={(event) => setPlanCue(event.target.value)}
                    placeholder="After dinner, show the first physical step."
                  />
                </label>
                <button
                  type="button"
                  onClick={handleSavePlan}
                  disabled={!!pendingAction || !planAt}
                >
                  {pendingAction === 'plan' ? 'SAVING PLAN…' : 'SAVE ACTION PLAN'}
                </button>
              </div>
            )}
          </section>

          {navigationError && (
            <p className="preview-navigation-error" role="alert">{navigationError}</p>
          )}

        </div>

        <div className="task-modal-footer">
          <button className="danger" onClick={handleDeleteTask} title="Delete this task" disabled={!!pendingAction}>
            {pendingAction === 'delete' ? 'DELETING...' : 'DELETE'}
          </button>
          <button onClick={handleSaveTodo} disabled={!canStart() || !!pendingAction}>
            {pendingAction === 'back' ? 'SAVING...' : '← BACK TO TODO'}
          </button>
          <button className="primary" onClick={startSession} disabled={!canStart() || !!pendingAction || (isPromiseMatch && !activeEffectsReady)}>
            {pendingAction === 'start'
              ? 'STARTING...'
              : isPromiseMatch && !activeEffectsReady ? 'LOADING MATCH RULES…' : 'BEGIN ACTION →'}
          </button>
        </div>
      </div>
    </div>
  );
});
