import './TaskCreationMenu.css';
import { useContext } from 'react';
import { AppContext } from '../../App.jsx';
import { v4 as uuid } from 'uuid';
import { STORES } from '../../utils/Constants.js';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { getDaysUntilDue } from '../../utils/Helpers/Tasks.js';

export default NiceModal.create(() => {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const [activeTask, setActiveTask] = useContext(AppContext).activeTask;
    const modal = useModal();

    const canSave = () => !!(activeTask.dueDate && activeTask.estimatedDuration);

    const handleSaveTodo = async () => {
        if (!canSave()) return;

        if (activeTask.originalDuration !== undefined) {
            const durationDiff = activeTask.estimatedDuration - activeTask.originalDuration;
            const currentPlayer = await databaseConnection.getCurrentPlayer();
            const daysUntil = getDaysUntilDue(activeTask);
            const delta = daysUntil > 0 ? parseInt(durationDiff) / daysUntil : 0;
            await databaseConnection.add(STORES.player, {
                ...currentPlayer,
                minutesClearedToday: currentPlayer.minutesClearedToday - delta,
            });
        }

        await databaseConnection.add(STORES.todo, { ...activeTask, UUID: uuid() });
        setActiveTask({});
        modal.hide();
        modal.remove();
    };

    const handleDiscard = () => {
        setActiveTask({});
        modal.hide();
        modal.remove();
    };

    return modal.visible ? (
        <div className="task-modal-overlay">
            <div className="blanker" onClick={handleDiscard} />
            <div className="task-modal">
                <div className="task-modal-header">
                    <span>TASK CREATION</span>
                </div>

                <div className="task-form-body">
                    <label className="full-width">
                        Task Name
                        <input
                            type="text"
                            placeholder="What are you working on?"
                            defaultValue={activeTask.name || ''}
                            onChange={e => setActiveTask(prev => ({ ...prev, name: e.target.value }))}
                        />
                    </label>

                    <label className="full-width">
                        Why did you pick this task?
                        <textarea
                            rows={2}
                            placeholder="Reason for selecting this task..."
                            defaultValue={activeTask.reasonToSelect || ''}
                            onChange={e => setActiveTask(prev => ({ ...prev, reasonToSelect: e.target.value }))}
                        />
                    </label>

                    <label className="full-width">
                        How will you use the time?
                        <textarea
                            rows={4}
                            placeholder="Session plan, approach, steps... (supports markdown)"
                            defaultValue={activeTask.efficiency || ''}
                            onChange={e => setActiveTask(prev => ({ ...prev, efficiency: e.target.value }))}
                        />
                    </label>

                    <div className="form-row">
                        <label>
                            Duration (min)
                            <input
                                type="number"
                                min="1"
                                defaultValue={Math.max(activeTask.estimatedDuration || 0, 0)}
                                onChange={e => setActiveTask(prev => ({ ...prev, estimatedDuration: e.target.value }))}
                            />
                        </label>
                        <label>
                            Due Date
                            <input
                                type="date"
                                defaultValue={activeTask.dueDate || ''}
                                onChange={e => setActiveTask(prev => ({ ...prev, dueDate: e.target.value }))}
                            />
                        </label>
                    </div>
                </div>

                <div className="task-modal-footer">
                    <button className="danger" onClick={handleDiscard}>DISCARD</button>
                    <button
                        className={`primary ${canSave() ? '' : 'disabled'}`}
                        onClick={handleSaveTodo}
                        disabled={!canSave()}
                    >
                        SAVE TO TODO →
                    </button>
                </div>
            </div>
        </div>
    ) : null;
});
