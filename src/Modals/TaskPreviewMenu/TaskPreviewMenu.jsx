import './TaskPreviewMenu.css';
import { useContext, useEffect } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';
import { getTodoWPD } from '../../utils/Helpers/Tasks.js';
import MarkdownEditor from '../../components/MarkdownEditor/MarkdownEditor.jsx';
import TaskSessionMenu from '../TaskSessionMenu/TaskSessionMenu.jsx';

export default NiceModal.create(() => {
  const { databaseConnection, refreshApp, activeTask: [activeTask, setActiveTask] } = useContext(AppContext);
  const modal = useModal();

  useEffect(() => {
    const suggested = Math.min(Math.max(1, Math.floor(getTodoWPD(activeTask))), 60);
    if (!activeTask.sessionDuration) {
      setActiveTask((previous) => ({ ...previous, sessionDuration: suggested }));
    }
  }, [activeTask, setActiveTask]);

  const close = () => {
    modal.hide();
    modal.remove();
  };

  const canStart = () => !!(activeTask.dueDate && activeTask.estimatedDuration);

  const startSession = async () => {
    const parent = await databaseConnection.getCurrentPlayer();
    setActiveTask((previous) => ({
      ...previous,
      createdAt: new Date().toISOString(),
      parent: parent.UUID,
      UUID: previous.UUID || uuid(),
      estimatedDuration: Number(previous.estimatedDuration || 0),
      sessionDuration: Number(previous.sessionDuration || 25),
    }));
    close();
    requestAnimationFrame(() => NiceModal.show(TaskSessionMenu));
  };

  const handleSaveTodo = async () => {
    const parent = await databaseConnection.getCurrentPlayer();
    await databaseConnection.add(STORES.todo, {
      ...activeTask,
      UUID: activeTask.UUID || uuid(),
      parent: parent?.UUID || activeTask.parent,
      estimatedDuration: Number(activeTask.estimatedDuration || 0),
      sessionDuration: Number(activeTask.sessionDuration || 25),
    });
    setActiveTask({});
    refreshApp();
    close();
  };

  const sessionDuration = Number(activeTask.sessionDuration || 25);

  if (!modal.visible) return null;

  return (
    <div className="task-modal-overlay">
      <div className="blanker" onClick={close} />
      <div className="task-modal">
        <div className="task-modal-header">
          <span>SESSION PREVIEW</span>
        </div>

        <div className="task-form-body">
          <label className="full-width">
            Task Name
            <input
              type="text"
              value={activeTask.name || ''}
              onChange={(event) => setActiveTask((previous) => ({ ...previous, name: event.target.value }))}
            />
          </label>

          <label className="full-width">
            Session Duration — <strong>{sessionDuration} min</strong>
            <input
              type="range"
              min="1"
              max="60"
              value={sessionDuration}
              onChange={(event) => setActiveTask((previous) => ({ ...previous, sessionDuration: Number(event.target.value) }))}
              className="range-input"
            />
            <div className="range-ticks">
              <span>1</span><span>15</span><span>30</span><span>45</span><span>60</span>
            </div>
          </label>

          <label className="full-width">
            Session Plan
            <MarkdownEditor
              value={activeTask.efficiency || ''}
              onChange={(value) => setActiveTask((previous) => ({ ...previous, efficiency: value }))}
              placeholder="How will you use the time?"
              className="plan-editor"
            />
          </label>
        </div>

        <div className="task-modal-footer">
          <button onClick={handleSaveTodo} disabled={!canStart()}>
            ← BACK TO TODO
          </button>
          <button className="primary" onClick={startSession} disabled={!canStart()}>
            START SESSION →
          </button>
        </div>
      </div>
    </div>
  );
});
