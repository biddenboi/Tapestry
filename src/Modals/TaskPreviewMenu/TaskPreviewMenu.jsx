import './TaskPreviewMenu.css';
import { useContext, useEffect } from 'react';
import { AppContext } from '../../App.jsx';
import { v4 as uuid } from 'uuid';
import { STORES } from '../../utils/Constants.js';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import TaskSessionMenu from '../TaskSessionMenu/TaskSessionMenu.jsx';
import { getTodoWPD } from '../../utils/Helpers/Tasks.js';
import MarkdownEditor from '../../Components/MarkdownEditor/MarkdownEditor.jsx';

export default NiceModal.create(() => {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const [activeTask, setActiveTask] = useContext(AppContext).activeTask;
    const modal = useModal();

    useEffect(() => {
        const suggested = Math.min(Math.floor(getTodoWPD(activeTask)), 60);
        if (!activeTask.sessionDuration) {
            setActiveTask(prev => ({ ...prev, sessionDuration: suggested }));
        }
    }, []);

    const canStart = () => !!(activeTask.dueDate && activeTask.estimatedDuration);
    const canSave = canStart;

    const startSession = async () => {
        const parent = await databaseConnection.getCurrentPlayer();
        setActiveTask(prev => ({
            ...prev,
            createdAt: new Date().toISOString(),
            parent: parent.UUID,
            UUID: uuid(),
        }));
        modal.hide();
        modal.remove();
        NiceModal.show(TaskSessionMenu);
    };

    const handleSaveTodo = async () => {
        await databaseConnection.add(STORES.todo, { ...activeTask, UUID: uuid() });
        setActiveTask({});
        modal.hide();
        modal.remove();
    };

    const sessionDuration = activeTask.sessionDuration || 25;

    return modal.visible ? (
        <div className="task-modal-overlay">
            <div className="blanker" />
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
                            onChange={e => setActiveTask(prev => ({ ...prev, name: e.target.value }))}
                        />
                    </label>

                    <label className="full-width">
                        Session Duration — <strong>{sessionDuration} min</strong>
                        <input
                            type="range"
                            min="1"
                            max="60"
                            value={sessionDuration}
                            onChange={e => setActiveTask(prev => ({ ...prev, sessionDuration: e.target.value }))}
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
                            onChange={v => setActiveTask(prev => ({ ...prev, efficiency: v }))}
                            placeholder="How will you use the time? (supports **bold**, *italic*, `code`, [links](url))"
                            className="plan-editor"
                        />
                    </label>
                </div>

                <div className="task-modal-footer">
                    <button onClick={handleSaveTodo} disabled={!canSave()}>
                        ← BACK TO TODO
                    </button>
                    <button className="primary" onClick={startSession} disabled={!canStart()}>
                        START SESSION →
                    </button>
                </div>
            </div>
        </div>
    ) : null;
});
