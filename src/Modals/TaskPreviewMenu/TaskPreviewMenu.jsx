import './TaskPreviewMenu.css';
import { useContext, useState } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES, MINUTE } from '../../utils/Constants.js';
import MarkdownEditor from '../../components/MarkdownEditor/MarkdownEditor.jsx';
import TaskSessionMenu from '../TaskSessionMenu/TaskSessionMenu.jsx';


export default NiceModal.create(() => {
  const { databaseConnection, refreshApp, activeTask: [activeTask, setActiveTask] } = useContext(AppContext);
  const modal = useModal();

  // Session commitment — pre-seed from any previously committed duration on this todo.
  const [sessionMinutes, setSessionMinutes] = useState(
    () => Math.round((Number(activeTask.sessionDuration) || 0) / MINUTE),
  );

  const close = () => {
    modal.hide();
    modal.remove();
  };

  const canStart = () => !!(activeTask.dueDate && activeTask.estimatedDuration);

  const handleSliderChange = (e) => setSessionMinutes(Number(e.target.value));

  const handleMinutesInput = (e) => {
    const v = parseInt(e.target.value, 10);
    setSessionMinutes(Number.isFinite(v) && v >= 0 ? v : 0);
  };

  const startSession = async () => {
    const parent = await databaseConnection.getCurrentPlayer();
    const committedMs = sessionMinutes * MINUTE;
    // Set createdAt to start the session clock. The commitment duration from
    // this input is stored on activeTask so TaskSessionMenu can seed from it.
    setActiveTask((previous) => ({
      ...previous,
      createdAt: new Date().toISOString(),
      parent: parent.UUID,
      UUID: previous.UUID || uuid(),
      estimatedDuration: Number(previous.estimatedDuration || 0),
      sessionDuration: committedMs,
    }));
    close();
    requestAnimationFrame(() => NiceModal.show(TaskSessionMenu));
  };

  const handleDeleteTask = async () => {
    if (activeTask.UUID) {
      await databaseConnection.remove(STORES.todo, activeTask.UUID);
      refreshApp();
    }
    setActiveTask({});
    close();
  };

  const handleSaveTodo = async () => {
    const parent = await databaseConnection.getCurrentPlayer();
    await databaseConnection.add(STORES.todo, {
      ...activeTask,
      UUID: activeTask.UUID || uuid(),
      parent: parent?.UUID || activeTask.parent,
      estimatedDuration: Number(activeTask.estimatedDuration || 0),
    });
    setActiveTask({});
    refreshApp();
    close();
  };

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

          {/* ── Session commitment ─────────────────────────── */}
          <div className="tcm-field-group">
            <span className="tcm-field-label">Session Commitment</span>
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
                max="60"
                step="5"
                value={Math.min(sessionMinutes, 60)}
                onChange={handleSliderChange}
              />
              {sessionMinutes > 0 && (
                <span className="preview-commitment-bonus">
                  +bonus if honoured
                </span>
              )}
            </div>
            <div className="range-ticks">
              <span>0</span>
              <span>15</span>
              <span>30</span>
              <span>45</span>
              <span>60+</span>
            </div>
          </div>

          <label className="full-width">
            Description
            <MarkdownEditor
              value={activeTask.efficiency || ''}
              onChange={(value) => setActiveTask((previous) => ({ ...previous, efficiency: value }))}
              placeholder="No description yet — add one by editing this task."
              className="plan-editor"
            />
          </label>

        </div>

        <div className="task-modal-footer">
          <button className="danger" onClick={handleDeleteTask} title="Delete this task">
            DELETE
          </button>
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