import './Todolist.css';
import { useState, useEffect, useContext } from 'react';
import { AppContext } from '../../App.jsx';
import { MINUTE, STORES } from '../../utils/Constants.js';
import { getWeights, getNextTodo, getAllWPDFromArray } from '../../utils/Helpers/Tasks.js';
import NiceModal from '@ebay/nice-modal-react';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import { prettyPrintDate, formatDuration } from '../../utils/Helpers/Time.js';
import TaskPreviewMenu from '../../Modals/TaskPreviewMenu/TaskPreviewMenu.jsx';

function TodoItem({ element }) {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const [activeTask, setActiveTask] = useContext(AppContext).activeTask;

    const handleSelectTodo = async (todo) => {
        setActiveTask({ ...todo, originalDuration: todo.estimatedDuration });
        await databaseConnection.remove(STORES.todo, todo.UUID);
        NiceModal.show(TaskCreationMenu);
    };

    return (
        <div className="todo-item" onClick={() => handleSelectTodo(element)}>
            <div className="todo-item-left">
                <span
                    className="todo-item-name"
                    style={{ color: `hsl(145, ${element.weight}%, 58%)` }}
                >
                    {element.name}
                </span>
                <span className="todo-item-meta">
                    {element.estimatedDuration}min
                    {element.weight ? ` · ${element.weight}%` : ''}
                </span>
            </div>
            <span className="todo-item-due">{prettyPrintDate(element.dueDate)}</span>
        </div>
    );
}

export default function TodoList({ style }) {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const [activeTask, setActiveTask] = useContext(AppContext).activeTask;

    const [todos, setTodos]           = useState([]);
    const [nextTodo, setNextTodo]     = useState(null);
    const [timeCleared, setTimeCleared] = useState(null);

    useEffect(() => {
        const reload = async () => {
            const todoArray     = await databaseConnection.getAll(STORES.todo);
            const currentPlayer = await databaseConnection.getCurrentPlayer();
            const weightArray   = getWeights(todoArray);

            const allWPD  = getAllWPDFromArray(todoArray);
            const sumWPD  = allWPD.reduce((a, c) => a + c, 0);
            const diff    = sumWPD - (currentPlayer?.minutesClearedToday ?? 0);

            setTimeCleared(formatDuration(diff * MINUTE));
            setTodos(todoArray.map((element, i) => ({
                ...element,
                weight: Math.floor(weightArray[i]),
            })));
            setNextTodo(getNextTodo(todoArray, weightArray));
        };
        reload();
    }, [databaseConnection, activeTask]);

    const handleGetNextTodo = async () => {
        if (!nextTodo) return;
        setActiveTask(nextTodo);
        await databaseConnection.remove(STORES.todo, nextTodo.UUID);
        setNextTodo(null);
        NiceModal.show(TaskPreviewMenu, { start: true });
    };

    return (
        <div className="todo-list" style={style}>
            <div className="todo-header">
                <span className="todo-header-title">TODO LIST</span>
                {timeCleared && (
                    <span className="todo-header-stat">{timeCleared} remaining today</span>
                )}
            </div>

            <div className="todo-items">
                {todos.length === 0 ? (
                    <p className="todo-empty">No tasks — add one with the button above.</p>
                ) : (
                    todos.map(element => (
                        <TodoItem key={element.UUID} element={element} />
                    ))
                )}
            </div>

            <div className="todo-footer">
                <button
                    className={`next-task-btn ${nextTodo ? 'primary' : 'disabled'}`}
                    onClick={handleGetNextTodo}
                    disabled={!nextTodo}
                >
                    ↑ NEXT TASK
                </button>
            </div>
        </div>
    );
}
