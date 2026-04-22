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

  useEffect(() => {
    if (!activeTask.createdAt) return undefined;
    const start = new Date(activeTask.createdAt).getTime();
    setElapsedMs(Date.now() - start);
    const id = setInterval(() => setElapsedMs(Date.now() - start), 1000);
    return () => clearInterval(id);
  }, [activeTask.createdAt]);

  const commitmentMet = committedMs > 0 && elapsedMs >= committedMs;

  const previewMultiplier = useMemo(
    () => getTaskMultiplier(activeTask, committedMs, committedMs),
    [activeTask, committedMs],
  );

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

    const task = {
      ...activeTask,
      parent: parent.UUID,
      completedAt: new Date().toISOString(),
      location: null,
      source: gameState,
      sessionDuration: sessionDurationMs,
    };

    const duration = getTaskDuration(task);
    const multiplier = getTaskMultiplier(activeTask, sessionDurationMs, duration);
    task.points = Math.floor(msToPoints(duration) * multiplier);

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
    setActiveTask((previous) => ({
      ...previous,
      estimatedDuration: remainingEstimate,
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
            <div className="session-multiplier">
              <span className="session-multiplier-val">{previewMultiplier.toFixed(2)}×</span>
              <span className="session-multiplier-lbl">if completed</span>
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