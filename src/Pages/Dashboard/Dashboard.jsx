import './Dashboard.css';
import { useContext, useEffect, useState, useRef } from 'react';
import { AppContext } from '../../App.jsx';
import TodoList from '../../components/TodoList/TodoList.jsx';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import NiceModal from '@ebay/nice-modal-react';
import JournalPopup from '../../Modals/JournalPopup/JournalPopup.jsx';
import { endDay, endWorkDay, startDay } from '../../utils/Helpers/Events.js';
import { EVENT } from '../../utils/Constants.js';
import EndDayConfirm from '../../Modals/EndDayConfirm/EndDayConfirm.jsx';
import { getMidnightOfDate, getLocalDate } from '../../utils/Helpers/Time';
import Purgatory from '../../Modals/Purgatory/Purgatory';
import StartDayPopup from '../../Modals/StartDayPopup/StartDayPopup.jsx';

function Dashboard() {
    const { databaseConnection, timestamp } = useContext(AppContext);
    const [scheduleStage, setScheduleStage] = useState(null);
    const isSyncing = useRef(false);

    useEffect(() => {
        const syncAndUpdateEvents = async () => {
            if (isSyncing.current) return;
            isSyncing.current = true;
            try {
                const p = await databaseConnection.getCurrentPlayer();
                if (!p || p.createdAt == null) return;
                const lastEvent = await databaseConnection.getLastEventType([EVENT.wake, EVENT.end_work, EVENT.sleep]);
                const midnight = getMidnightOfDate(getLocalDate(new Date()));

                if (lastEvent === null) {
                    await startDay(databaseConnection, p);
                    return;
                }
                if (getLocalDate(new Date(lastEvent.createdAt)) < midnight) {
                    if (lastEvent.type === EVENT.sleep) {
                        await startDay(databaseConnection, p);
                    } else {
                        await endDay(databaseConnection, p, false);
                        await startDay(databaseConnection, p);
                    }
                }
                if (lastEvent.type === EVENT.sleep) {
                    NiceModal.show(Purgatory);
                }
            } finally {
                isSyncing.current = false;
            }
        };
        syncAndUpdateEvents();
    }, [timestamp]);

    useEffect(() => {
        const getScheduleStage = async () => {
            const currentStage = await databaseConnection.getLastEventType([EVENT.wake, EVENT.end_work, EVENT.sleep]);
            setScheduleStage(currentStage);
        };
        getScheduleStage();
    }, [timestamp]);

    const handleEndWorkDay = async () => {
        const currentPlayer = await databaseConnection.getCurrentPlayer();
        endWorkDay(databaseConnection, currentPlayer);
    };

    const handleEndDay = () => NiceModal.show(EndDayConfirm);
    const handleAddTask = () => NiceModal.show(TaskCreationMenu, { start: false });

    if (scheduleStage == null) return null;

    const isWorkDay = scheduleStage.type === EVENT.wake;

    return (
        <div className="dashboard">
            <div className="dashboard-toolbar">
                <button className="toolbar-btn primary" onClick={handleAddTask}>
                    + NEW TASK
                </button>
                <div className="toolbar-spacer" />
                {isWorkDay ? (
                    <button className="toolbar-btn" onClick={handleEndWorkDay}>
                        END WORK DAY
                    </button>
                ) : (
                    <button className="toolbar-btn danger" onClick={handleEndDay}>
                        END DAY
                    </button>
                )}
            </div>
            <div className="dashboard-content">
                <TodoList />
            </div>
        </div>
    );
}

export default Dashboard;
