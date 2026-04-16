import '../TaskCreationMenu/TaskCreationMenu.css';
import './TaskSessionMenu.css';
import { useContext } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { MINUTE, STORES } from '../../utils/Constants.js';
import { msToPoints } from '../../utils/Helpers/Time.js';
import { getCurrentLocation } from '../../utils/Helpers/Location.js';
import { getSessionMultiplier, getTaskDuration } from '../../utils/Helpers/Tasks.js';
import MarkdownEditor from '../../components/MarkdownEditor/MarkdownEditor.jsx';
import Timer from '../../components/Timer/Timer.jsx';
import TaskCreationMenu from '../TaskCreationMenu/TaskCreationMenu.jsx';
import SessionResults from '../SessionResults/SessionResults.jsx';

export default NiceModal.create(() => {
  const {
    databaseConnection,
    refreshApp,
    activeTask: [activeTask, setActiveTask],
  } = useContext(AppContext);
  const modal = useModal();

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
    const sessionDuration = Number(activeTask.sessionDuration || 0);
    const parent = await databaseConnection.getCurrentPlayer();

    const task = {
      ...activeTask,
      parent: parent.UUID,
      completedAt: new Date().toISOString(),
      location: null,
    };

    const duration = getTaskDuration(task);
    const multiplier = getSessionMultiplier(duration, sessionDuration * MINUTE);
    task.points = Math.floor(msToPoints(duration) * multiplier);

    const tokensGained = Math.floor(msToPoints(duration) / 6);

    await databaseConnection.add(STORES.player, {
      ...parent,
      tokens: Math.floor((parent.tokens || 0) + tokensGained),
      minutesClearedToday: (parent.minutesClearedToday || 0) + sessionDuration,
    });

    await databaseConnection.add(STORES.task, task);

    const remainingEstimate = Math.max(0, estimatedDuration - sessionDuration);
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
        sessionDuration,
        showTaskCreation: remainingEstimate > 0,
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

  return (
    <div className="task-modal-overlay">
      <div className="blanker" />
      <div className="task-modal session-modal">
        <div className="task-modal-header">
          <span>IN SESSION</span>
          <span className="session-duration-badge">{activeTask.sessionDuration} min</span>
        </div>

        <div className="session-task-info">
          <p className="session-task-name">{activeTask.name}</p>
          {activeTask.reasonToSelect && <p className="session-task-reason">{activeTask.reasonToSelect}</p>}
        </div>

        <div className="session-timer-bar">
          <Timer showPoints={false} startTime={new Date(activeTask.createdAt).getTime()} duration={activeTask.sessionDuration} />
        </div>

        <div className="session-plan-wrap">
          <div className="session-plan-label">Plan</div>
          <div className="session-plan-content">
            <MarkdownEditor value={activeTask.efficiency || ''} readOnly />
          </div>
        </div>

        <div className="task-modal-footer">
          <button className="danger" onClick={handleGiveUpTask}>← GIVE UP</button>
          <button className="primary" onClick={handleTaskSubmit}>COMPLETE →</button>
        </div>
      </div>
    </div>
  );
});
