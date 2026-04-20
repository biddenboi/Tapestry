import './TaskCreationMenu.css';
import { useContext } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';
import { getDaysUntilDue } from '../../utils/Helpers/Tasks.js';
import MarkdownEditor from '../../components/MarkdownEditor/MarkdownEditor.jsx';

export default NiceModal.create(() => {
  const { databaseConnection, refreshApp, activeTask: [activeTask, setActiveTask] } = useContext(AppContext);
  const modal = useModal();

  const canSave = () => !!(activeTask.dueDate && activeTask.estimatedDuration);

  const close = () => {
    modal.hide();
    modal.remove();
  };

  const handleSaveTodo = async () => {
    if (!canSave()) return;
    const currentPlayer = await databaseConnection.getCurrentPlayer();
    const estimatedDuration = Number(activeTask.estimatedDuration || 0);

    if (activeTask.originalDuration !== undefined) {
      const durationDiff = estimatedDuration - Number(activeTask.originalDuration || 0);
      const daysUntil = getDaysUntilDue(activeTask);
      const delta = daysUntil > 0 ? durationDiff / daysUntil : 0;
      await databaseConnection.add(STORES.player, {
        ...currentPlayer,
        minutesClearedToday: (currentPlayer.minutesClearedToday || 0) - delta,
      });
    }

    await databaseConnection.add(STORES.todo, {
      ...activeTask,
      UUID: activeTask.UUID || uuid(),
      parent: currentPlayer?.UUID || activeTask.parent,
      estimatedDuration,
    });

    setActiveTask({});
    refreshApp();
    close();
  };

  const handleDelete = async () => {
    if (activeTask.UUID) {
      await databaseConnection.remove(STORES.todo, activeTask.UUID);
      refreshApp();
    }
    setActiveTask({});
    close();
  };

  const handleDiscard = () => {
    setActiveTask({});
    close();
  };

  if (!modal.visible) return null;

  return (
    <div className="task-modal-overlay">
      <div className="blanker" onClick={handleDiscard} />
      <div className="task-modal">
        <div className="task-modal-header">
          <span>TASK CREATION</span>
          {activeTask.UUID && (
            <button className="tcm-delete-btn" onClick={handleDelete} title="Delete this task">
              ✕ DELETE
            </button>
          )}
        </div>

        <div className="task-form-body">
          <label className="full-width">
            Task Name
            <input
              type="text"
              placeholder="What are you working on?"
              value={activeTask.name || ''}
              onChange={(event) => setActiveTask((previous) => ({ ...previous, name: event.target.value }))}
            />
          </label>

          <label className="full-width">
            How will you use the time?
            <MarkdownEditor
              value={activeTask.efficiency || ''}
              onChange={(value) => setActiveTask((previous) => ({ ...previous, efficiency: value }))}
              placeholder="Session plan, approach, steps..."
              className="plan-editor"
            />
          </label>

          <div className="form-row">
            <label>
              Duration (min)
              <input
                type="number"
                min="1"
                value={Math.max(Number(activeTask.estimatedDuration || 0), 0)}
                onChange={(event) => setActiveTask((previous) => ({ ...previous, estimatedDuration: Number(event.target.value) }))}
              />
            </label>
            <label>
              Due Date
              <input
                type="date"
                value={activeTask.dueDate || ''}
                onChange={(event) => setActiveTask((previous) => ({ ...previous, dueDate: event.target.value }))}
              />
            </label>
          </div>
        </div>

        <div className="task-modal-footer">
          <button onClick={handleDiscard}>DISCARD</button>
          <button className="primary" onClick={handleSaveTodo} disabled={!canSave()}>
            SAVE TODO
          </button>
        </div>
      </div>
    </div>
  );
});
