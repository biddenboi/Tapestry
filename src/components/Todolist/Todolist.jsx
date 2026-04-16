import './TodoList.css';
import { useState, useEffect, useContext, useMemo } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { GAME_STATE, MINUTE, STORES } from '../../utils/Constants.js';
import { getWeights, getNextTodo, getAllWPDFromArray } from '../../utils/Helpers/Tasks.js';
import { prettyPrintDate, formatDuration } from '../../utils/Helpers/Time.js';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import TaskPreviewMenu from '../../Modals/TaskPreviewMenu/TaskPreviewMenu.jsx';

function TodoItem({ element, onSelect }) {
  return (
    <div className="todo-item" onClick={() => onSelect(element)} role="button" tabIndex={0}>
      <div className="todo-item-left">
        <span className="todo-item-name" style={{ color: `hsl(145, ${element.weight}%, 58%)` }}>
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
  const {
    databaseConnection,
    refreshApp,
    closePanel,
    gameState: [gameState],
    activeTask: [activeTask, setActiveTask],
  } = useContext(AppContext);

  const [todos, setTodos] = useState([]);
  const [nextTodo, setNextTodo] = useState(null);
  const [timeCleared, setTimeCleared] = useState(null);

  useEffect(() => {
    const reload = async () => {
      const todoArray = await databaseConnection.getAll(STORES.todo);
      const currentPlayer = await databaseConnection.getCurrentPlayer();
      const weightArray = getWeights(todoArray);

      const allWPD = getAllWPDFromArray(todoArray);
      const sumWPD = allWPD.reduce((accumulator, current) => accumulator + current, 0);
      const diff = sumWPD - (currentPlayer?.minutesClearedToday ?? 0);

      setTimeCleared(formatDuration(diff * MINUTE));
      setTodos(todoArray.map((element, index) => ({
        ...element,
        weight: Math.floor(weightArray[index] || 0),
      })));
      setNextTodo(getNextTodo(todoArray, weightArray));
    };

    reload();
  }, [databaseConnection, activeTask, refreshApp]);

  const inSessionMode = useMemo(() => gameState === GAME_STATE.practice || gameState === GAME_STATE.match, [gameState]);

  const openTaskFlow = async (todo) => {
    if (!todo) return;
    const currentPlayer = await databaseConnection.getCurrentPlayer();
    const taskDraft = {
      ...todo,
      parent: currentPlayer?.UUID || todo.parent,
      originalDuration: Number(todo.estimatedDuration || 0),
    };

    setActiveTask(taskDraft);
    await databaseConnection.remove(STORES.todo, todo.UUID);
    closePanel();
    refreshApp();

    requestAnimationFrame(() => {
      NiceModal.show(inSessionMode ? TaskPreviewMenu : TaskCreationMenu);
    });
  };

  return (
    <div className="todo-list" style={style}>
      <div className="todo-header">
        <span className="todo-header-title">TODO LIST</span>
        {timeCleared && <span className="todo-header-stat">{timeCleared} remaining today</span>}
      </div>

      <div className="todo-items">
        {todos.length === 0 ? (
          <p className="todo-empty">No tasks — add one with the button above.</p>
        ) : (
          todos.map((element) => (
            <TodoItem key={element.UUID} element={element} onSelect={openTaskFlow} />
          ))
        )}
      </div>

      <div className="todo-footer">
        <button
          className={`next-task-btn ${nextTodo ? 'primary' : 'disabled'}`}
          onClick={() => openTaskFlow(nextTodo)}
          disabled={!nextTodo}
        >
          ↑ NEXT TASK
        </button>
      </div>
    </div>
  );
}
