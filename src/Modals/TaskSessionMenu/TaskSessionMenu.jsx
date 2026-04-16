import '../TaskCreationMenu/TaskCreationMenu.css';
import './TaskSessionMenu.css';
import { useContext } from 'react';
import { AppContext } from '../../App.jsx';
import Timer from '../../Components/Timer/Timer.jsx';
import { msToPoints } from '../../utils/Helpers/Time.js';
import { v4 as uuid } from 'uuid';
import { MINUTE, STORES } from '../../utils/Constants.js';
import { getCurrentLocation } from '../../utils/Helpers/Location.js';
import { getSessionMultiplier, getTaskDuration } from '../../utils/Helpers/Tasks.js';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import TaskCreationMenu from '../TaskCreationMenu/TaskCreationMenu.jsx';
import SessionResults from '../SessionResults/SessionResults.jsx';
import MarkdownEditor from '../../Components/MarkdownEditor/MarkdownEditor.jsx';

export default NiceModal.create(() => {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const [activeTask, setActiveTask] = useContext(AppContext).activeTask;
    const modal = useModal();

    const handleGiveUpTask = async () => {
        setActiveTask({ ...activeTask, createdAt: null });
        modal.hide();
        modal.remove();
        NiceModal.show(TaskCreationMenu);
    };

    const handleTaskSubmit = async () => {
        const estimatedDuration = parseFloat(activeTask.estimatedDuration) || 0;
        const sessionDuration   = parseFloat(activeTask.sessionDuration)   || 0;
        const parent = await databaseConnection.getCurrentPlayer();

        const task = {
            ...activeTask,
            points: null,
            completedAt: new Date().toISOString(),
            location: null,
        };

        const duration = getTaskDuration(task);
        const multiplier = getSessionMultiplier(duration, sessionDuration * MINUTE);
        task.points = Math.floor(msToPoints(duration) * multiplier);

        const tokensGained = Math.floor(msToPoints(duration) / 6);

        await databaseConnection.add(STORES.player, {
            ...parent,
            tokens: Math.floor(parent.tokens + tokensGained),
            minutesClearedToday: parent.minutesClearedToday + parseFloat(sessionDuration || 0),
        });

        await databaseConnection.add(STORES.task, task);

        modal.hide();
        modal.remove();

        NiceModal.show(SessionResults, {
            duration,
            tokens: tokensGained,
            sessionDuration,
            showTaskCreation: true,
        });

        activeTask.estimatedDuration = estimatedDuration - sessionDuration;
        setActiveTask({ ...activeTask, createdAt: null });

        getCurrentLocation()
            .then(async (location) => {
                if (!location) return;
                await databaseConnection.add(STORES.task, { ...task, location });
            })
            .catch(err => console.error('Background location update failed:', err));
    };

    return modal.visible ? (
        <div className="task-modal-overlay">
            <div className="blanker" />
            <div className="task-modal session-modal">

                <div className="task-modal-header">
                    <span>IN SESSION</span>
                    <span className="session-duration-badge">
                        {activeTask.sessionDuration} min
                    </span>
                </div>

                {/* Task identity */}
                <div className="session-task-info">
                    <p className="session-task-name">{activeTask.name}</p>
                    {activeTask.reasonToSelect && (
                        <p className="session-task-reason">{activeTask.reasonToSelect}</p>
                    )}
                </div>

                {/* Plan (read-only markdown) */}
                <div className="session-plan-wrap">
                    <div className="session-plan-label">Plan</div>
                    <div className="session-plan-content">
                        <MarkdownEditor
                            value={activeTask.efficiency || ''}
                            readOnly={true}
                        />
                    </div>
                </div>

                {/* Action buttons */}
                <div className="task-modal-footer">
                    <button className="danger" onClick={handleGiveUpTask}>
                        ← GIVE UP
                    </button>
                    <button className="primary" onClick={handleTaskSubmit}>
                        COMPLETE →
                    </button>
                </div>
            </div>
        </div>
    ) : null;
});
