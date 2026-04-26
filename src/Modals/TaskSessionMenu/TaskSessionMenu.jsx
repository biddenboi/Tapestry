import '../TaskCreationMenu/TaskCreationMenu.css';
import './TaskSessionMenu.css';
import { useContext, useState, useEffect, useMemo } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { MINUTE, STORES } from '../../utils/Constants.js';
import { msToPoints, timeAsHHMMSS, formatDuration } from '../../utils/Helpers/Time.js';
import { getCurrentLocation } from '../../utils/Helpers/Location.js';
import { getTaskDuration, getTaskMultiplier, getTokensFromTask } from '../../utils/Helpers/Tasks.js';
import TaskCreationMenu from '../TaskCreationMenu/TaskCreationMenu.jsx';
import SessionResults from '../SessionResults/SessionResults.jsx';
import MarkdownEditor from '../../components/MarkdownEditor/MarkdownEditor.jsx';
import { checkPassiveAchievements, getAchievementByKey } from '../../utils/Achievements.js';


export default NiceModal.create(() => {
  const {
    databaseConnection,
    refreshApp,
    notify,
    gameState: [gameState],
    activeTask: [activeTask, setActiveTask],
  } = useContext(AppContext);
  const modal = useModal();

  // Seeded from activeTask.sessionDuration set in the preview screen — locked for this session.
  const [committedMs] = useState(() => Number(activeTask.sessionDuration) || 0);

  const [elapsedMs, setElapsedMs] = useState(0);

  // Active event buffs at the time the session is being run. We snapshot the
  // total once on mount (and refresh on activeTask change) so the displayed
  // multiplier doesn't tick up/down mid-session as background buffs change.
  const [eventBuffs, setEventBuffs] = useState([]);
  const [showBuffBreakdown, setShowBuffBreakdown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const player = await databaseConnection.getCurrentPlayer();
      if (!player?.UUID) return;
      const buffs = await databaseConnection.getActiveEventBuffsForPlayer(player.UUID);
      if (!cancelled) setEventBuffs(buffs || []);
    })();
    return () => { cancelled = true; };
  }, [databaseConnection, activeTask?.createdAt]);

  const eventBuffTotal = useMemo(() => {
    if (!eventBuffs.length) return 1;
    return eventBuffs.reduce((acc, b) => acc * (Number(b.multiplierValue) || 1), 1);
  }, [eventBuffs]);

  useEffect(() => {
    if (!activeTask.createdAt) return undefined;
    const start = new Date(activeTask.createdAt).getTime();
    setElapsedMs(Date.now() - start);
    const id = setInterval(() => setElapsedMs(Date.now() - start), 1000);
    return () => clearInterval(id);
  }, [activeTask.createdAt]);

  const commitmentMet = committedMs > 0 && elapsedMs >= committedMs;

  const previewTaskMultiplier = useMemo(
    () => getTaskMultiplier(activeTask, committedMs, committedMs),
    [activeTask, committedMs],
  );
  const previewTotalMultiplier = previewTaskMultiplier * eventBuffTotal;

  const close = () => {
    modal.hide();
    modal.remove();
  };

  const handleGiveUpTask = async () => {
    setActiveTask((previous) => ({ ...previous, createdAt: null }));
    close();
    requestAnimationFrame(() => NiceModal.show(TaskCreationMenu));
  };

  const handleTaskSubmit = async () => {
    const estimatedDuration = Number(activeTask.estimatedDuration || 0);
    const sessionDurationMs = committedMs;
    const parent = await databaseConnection.getCurrentPlayer();

    // Re-fetch buffs at submit time so the points calculation reflects any
    // logging the user did between session start and submit.
    const liveBuffs = await databaseConnection.getActiveEventBuffsForPlayer(parent.UUID);
    const liveEventBuffTotal = (liveBuffs || []).reduce(
      (acc, b) => acc * (Number(b.multiplierValue) || 1),
      1,
    );

    const task = {
      ...activeTask,
      // Always mint a fresh UUID for the completed-task record so that doing
      // the same todo multiple times creates distinct entries in STORES.task.
      // (databaseConnection.add uses IndexedDB `put`, which overwrites on key
      // collision — using the todo UUID would silently erase earlier sessions.)
      UUID: uuid(),
      todoUUID: activeTask.UUID,   // preserve link back to the source todo
      parent: parent.UUID,
      completedAt: new Date().toISOString(),
      location: null,
      source: gameState,
      sessionDuration: sessionDurationMs,
    };

    const duration = getTaskDuration(task);
    // The task multiplier (aversion × urgency × commitment) should only
    // apply to the time the player committed to. Any time worked beyond the
    // commitment earns points at the base rate (aversion × urgency only,
    // no commitment bonus). This prevents the multiplier from inflating
    // points for time that was never committed.
    const taskMultiplierFull = getTaskMultiplier(activeTask, sessionDurationMs, duration);
    // No-commitment variant: passes 0 for committedMs so commitmentWeight = 1.0,
    // leaving only aversion × urgency in effect.
    const taskMultiplierBase = getTaskMultiplier(activeTask, 0, 0);

    const committedPortion = sessionDurationMs > 0
      ? Math.min(duration, sessionDurationMs)
      : duration; // no commitment — treat all time as "committed"
    const overPortion = Math.max(0, duration - committedPortion);

    task.points = Math.floor(
      msToPoints(committedPortion) * taskMultiplierFull * liveEventBuffTotal +
      msToPoints(overPortion) * taskMultiplierBase * liveEventBuffTotal,
    );
    task.eventBuffMultiplier = liveEventBuffTotal;

    const tokensGained = getTokensFromTask(activeTask, sessionDurationMs, duration);
    const sessionDurationMinutes = sessionDurationMs / MINUTE;

    await databaseConnection.add(STORES.player, {
      ...parent,
      tokens: Math.floor((parent.tokens || 0) + tokensGained),
      minutesClearedToday: (parent.minutesClearedToday || 0) + sessionDurationMinutes,
    });

    await databaseConnection.add(STORES.task, task);

    const freshPlayer = await databaseConnection.getCurrentPlayer();
    if (freshPlayer) {
      const newlyEarned = await checkPassiveAchievements(freshPlayer, databaseConnection);
      for (const key of newlyEarned) {
        const a = getAchievementByKey(key);
        if (a) notify({ title: 'Achievement Unlocked', message: a.label, kind: 'success', persist: false });
      }
    }

    const remainingEstimate = Math.max(0, estimatedDuration - sessionDurationMinutes);
    // If the session ran past the estimated duration, remainingEstimate would be 0,
    // which breaks TaskCreationMenu's canSave check. Fall back to the original
    // estimated duration so the user can always re-queue the task.
    const estimatedForCreation = remainingEstimate > 0 ? remainingEstimate : estimatedDuration;
    setActiveTask((previous) => ({
      ...previous,
      estimatedDuration: estimatedForCreation,
      createdAt: null,
      lastCompletedTask: task,
    }));

    refreshApp();
    close();

    requestAnimationFrame(() => {
      NiceModal.show(SessionResults, {
        duration,
        tokens: tokensGained,
        showTaskCreation: true,
      });
    });

    getCurrentLocation()
      .then(async (location) => {
        if (!location) return;
        await databaseConnection.add(STORES.task, { ...task, location });
        refreshApp();
      })
      .catch(() => undefined);
  };

  if (!modal.visible) return null;

  const timerClass = commitmentMet ? 'session-elapsed session-elapsed--over' : 'session-elapsed';
  const hasEventBuffs = eventBuffs.length > 0;

  return (
    <div className="task-modal-overlay">
      <div className="blanker" />
      <div className="task-modal session-modal">

        {/* ── Identity ─────────────────────────────────────── */}
        <div className="session-identity">
          <div className="session-eyebrow">In Session</div>
          <p className="session-task-name">{activeTask.name}</p>
          {activeTask.reasonToSelect && (
            <p className="session-task-reason">{activeTask.reasonToSelect}</p>
          )}
          {activeTask.efficiency && (
            <div className="session-description">
              <MarkdownEditor value={activeTask.efficiency} readOnly />
            </div>
          )}
          {committedMs > 0 && (
            <button
              type="button"
              className={`session-multiplier ${hasEventBuffs ? 'session-multiplier--stacked' : ''}`}
              onClick={() => hasEventBuffs && setShowBuffBreakdown((v) => !v)}
              disabled={!hasEventBuffs}
              title={hasEventBuffs ? 'Tap to see event buff breakdown' : ''}
            >
              <span className="session-multiplier-val">{previewTotalMultiplier.toFixed(2)}×</span>
              {hasEventBuffs ? (
                <span className="session-multiplier-breakdown">
                  task {previewTaskMultiplier.toFixed(2)} · evt {eventBuffTotal.toFixed(2)}
                </span>
              ) : (
                <span className="session-multiplier-lbl">if completed</span>
              )}
            </button>
          )}
          {showBuffBreakdown && hasEventBuffs && (
            <div className="session-buff-pop" onClick={() => setShowBuffBreakdown(false)}>
              <div className="session-buff-pop-head">ACTIVE EVENT BUFFS</div>
              <ul className="session-buff-pop-list">
                {eventBuffs.map((b) => (
                  <li key={b.UUID}>
                    <span className="session-buff-pop-name">{b.label || 'Buff'}</span>
                    <span className="session-buff-pop-val">×{Number(b.multiplierValue || 1).toFixed(3)}</span>
                  </li>
                ))}
              </ul>
              <div className="session-buff-pop-foot">
                <span>combined</span>
                <span className="session-buff-pop-val">×{eventBuffTotal.toFixed(3)}</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Timer ────────────────────────────────────────── */}
        <div className="session-timer-block">
          <div className="session-timer-left">
            <span className={timerClass}>{timeAsHHMMSS(elapsedMs)}</span>
            {committedMs > 0 && (
              <span className="session-timer-sub">
                {commitmentMet
                  ? `committed ${formatDuration(committedMs)} — bonus secured`
                  : `committed ${formatDuration(committedMs)}`}
              </span>
            )}
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────── */}
        <div className="task-modal-footer">
          <button className="danger" onClick={handleGiveUpTask}>← GIVE UP</button>
          {commitmentMet ? (
            <button className="primary" onClick={handleTaskSubmit}>COMPLETE →</button>
          ) : (
            <button className="complete-forfeit" onClick={handleTaskSubmit}>FORFEIT BONUS</button>
          )}
        </div>

      </div>
    </div>
  );
});