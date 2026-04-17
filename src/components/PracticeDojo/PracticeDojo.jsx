// src/components/PracticeDojo/PracticeDojo.jsx

import { useContext, useState, useEffect, useRef } from 'react';
import { AppContext } from '../../App.jsx';
import { GAME_STATE, STORES } from '../../utils/Constants.js';
import NiceModal from '@ebay/nice-modal-react';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import TaskPreviewMenu  from '../../Modals/TaskPreviewMenu/TaskPreviewMenu.jsx';
import { getNextTodo, getWeights } from '../../utils/Helpers/Tasks.js';
import { msToPoints } from '../../utils/Helpers/Time.js';
import ProfilePicture from '../ProfilePicture/ProfilePicture.jsx';
import { timeAsHHMMSS } from '../../utils/Helpers/Time.js';
import './PracticeDojo.css';

function useSessionTimer(startMs) {
    const [elapsed, setElapsed] = useState(startMs ? Date.now() - startMs : 0);
    useEffect(() => {
        if (!startMs) return;
        const id = setInterval(() => setElapsed(Date.now() - startMs), 1000);
        return () => clearInterval(id);
    }, [startMs]);
    return elapsed;
}

export default function PracticeDojo() {
    const {
        databaseConnection, timestamp, currentPlayer,
        gameState:   [, setGameState],
        activeTask:  [activeTask, setActiveTask],
        openPanel,
    } = useContext(AppContext);

    const [sessionStart]    = useState(() => Date.now());
    const [sessionPoints, setSessionPoints] = useState(0);
    const [todoCount, setTodoCount]         = useState(0);
    const [nextTodo, setNextTodo]           = useState(null);
    const [taskHistory, setTaskHistory]     = useState([]);
    const [topSessions, setTopSessions]     = useState([]);

    const elapsed = useSessionTimer(sessionStart);

    useEffect(() => {
        const load = async () => {
            if (!currentPlayer) return;

            // Session points = tasks completed since dojo entry
            const now = new Date().toISOString();
            const tasks = await databaseConnection.getStoreFromRange(
                STORES.task,
                new Date(sessionStart).toISOString(),
                now
            );
            const mine = tasks.filter(t => t.parent === currentPlayer.UUID);
            setSessionPoints(mine.reduce((s, t) => s + (t.points || 0), 0));
            setTaskHistory(mine.slice().reverse().slice(0, 5));

            // Next todo suggestion
            const todos   = await databaseConnection.getAll(STORES.todo);
            const weights = getWeights(todos);
            setNextTodo(getNextTodo(todos, weights));
            setTodoCount(todos.length);

            // Top sessions: best single-day point totals across all players
            const allPlayers = await databaseConnection.getAllPlayers();
            const playerMap  = Object.fromEntries(allPlayers.map((p) => [p.UUID, p]));
            const allTasks   = await databaseConnection.getAll(STORES.task);
            const dayMap = {};
            allTasks.filter((t) => t.completedAt && t.parent).forEach((t) => {
                const day = t.completedAt.split('T')[0];
                const key = `${t.parent}__${day}`;
                if (!dayMap[key]) dayMap[key] = { playerUUID: t.parent, day, points: 0 };
                dayMap[key].points += (t.points || 0);
            });
            const sessions = Object.values(dayMap)
                .sort((a, b) => b.points - a.points)
                .slice(0, 10)
                .map((s) => ({ ...s, player: playerMap[s.playerUUID] }))
                .filter((s) => s.player);
            setTopSessions(sessions);
        };
        load();
    }, [timestamp, currentPlayer, sessionStart]);

    const handleAddTask   = () => NiceModal.show(TaskCreationMenu);
    const handleGetNext   = () => {
        if (!nextTodo) return;
        setActiveTask(nextTodo);
        NiceModal.show(TaskPreviewMenu, { start: true });
    };
    const handleExitDojo  = () => {
        if (activeTask.createdAt) return; // don't leave mid-session
        setGameState(GAME_STATE.idle);
    };

    const inTask    = !!activeTask.createdAt;
    const username  = currentPlayer?.username ?? 'AGENT';

    return (
        <div className="dojo">
            <div className="dojo-bg" aria-hidden="true" />

            {/* ── Header band ── */}
            <div className="dojo-header">
                <div className="dojo-header-left">
                    <span className="dojo-eyebrow">PRACTICE MODE</span>
                    <span className="dojo-session-time">{timeAsHHMMSS(elapsed)}</span>
                </div>
                <div className="dojo-header-right">
                    <button className="dojo-add-btn" onClick={handleAddTask}>+ TASK</button>
                    <button className="dojo-queue-btn" onClick={() => openPanel('tasks')}>QUEUE ({todoCount})</button>
                    <button
                        className="dojo-exit-btn danger"
                        onClick={handleExitDojo}
                        disabled={inTask}
                        title={inTask ? 'Finish current session first' : 'Leave dojo'}
                    >
                        EXIT
                    </button>
                </div>
            </div>

            {/* ── Main arena ── */}
            <div className="dojo-arena">

                {/* Player pod */}
                <div className={`dojo-pod ${inTask ? 'dojo-pod--active' : ''}`}>
                    <div className="dojo-pod-glow" />

                    <ProfilePicture
                        src={currentPlayer?.profilePicture}
                        username={username}
                        size={96}
                        className="dojo-avatar"
                    />

                    <div className="dojo-pod-name">{username}</div>
                    <div className="dojo-pod-status">
                        {inTask ? (
                            <span className="pod-status-active">⬤ IN SESSION</span>
                        ) : (
                            <span className="pod-status-idle">◯ IDLE</span>
                        )}
                    </div>

                    <div className="dojo-score-display">
                        <span className="dojo-score-val">{sessionPoints.toLocaleString()}</span>
                        <span className="dojo-score-lbl">SESSION POINTS</span>
                    </div>
                </div>

                {/* Task panel */}
                <div className="dojo-task-panel">
                    {inTask ? (
                        <div className="dojo-current-task">
                            <div className="dct-label">ACTIVE TASK</div>
                            <div className="dct-name">{activeTask.name}</div>
                            {activeTask.reasonToSelect && (
                                <div className="dct-reason">{activeTask.reasonToSelect}</div>
                            )}
                            <div className="dct-hint">Complete or give up from the session window.</div>
                        </div>
                    ) : (
                        <div className="dojo-next-panel">
                            <div className="dnp-label">NEXT SUGGESTED</div>
                            {nextTodo ? (
                                <>
                                    <div className="dnp-name">{nextTodo.name}</div>
                                    <div className="dnp-meta">
                                        {nextTodo.estimatedDuration}min · due {nextTodo.dueDate}
                                    </div>
                                    <button className="dnp-start primary" onClick={handleGetNext}>
                                        START THIS TASK →
                                    </button>
                                </>
                            ) : (
                                <>
                                    <div className="dnp-empty">No tasks queued.</div>
                                    <button className="dnp-start primary" onClick={handleAddTask}>
                                        + ADD A TASK
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {/* Mini task history */}
                    {taskHistory.length > 0 && (
                        <div className="dojo-history">
                            <div className="dojo-history-label">COMPLETED THIS SESSION</div>
                            {taskHistory.map(t => (
                                <div key={t.UUID} className="dojo-history-row">
                                    <span className="dhr-name">{t.name}</span>
                                    <span className="dhr-pts">+{t.points ?? 0}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>{/* end dojo-task-panel */}

                {/* Top sessions leaderboard */}
                <div className="dojo-leaderboard">
                    <div className="dojo-lb-title">TOP SESSIONS</div>
                    <div className="dojo-lb-sub">Best single-day point totals</div>
                    {topSessions.length === 0 ? (
                        <div className="dojo-lb-empty">Complete tasks to appear here.</div>
                    ) : (
                        <div className="dojo-lb-list">
                            {topSessions.map((s, i) => {
                                const isSelf = s.playerUUID === currentPlayer?.UUID;
                                return (
                                    <div key={`${s.playerUUID}-${s.day}`} className={`dojo-lb-row${isSelf ? ' dojo-lb-row--self' : ''}`}>
                                        <span className={`dojo-lb-rank${i < 3 ? ` dojo-lb-rank--${i+1}` : ''}`}>#{i+1}</span>
                                        <div className="dojo-lb-info">
                                            <span className="dojo-lb-name">{s.player.username || 'Unknown'}</span>
                                            <span className="dojo-lb-date">{new Date(s.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                        </div>
                                        <span className="dojo-lb-pts">{s.points.toLocaleString()} <span className="dojo-lb-pts-lbl">pts</span></span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}