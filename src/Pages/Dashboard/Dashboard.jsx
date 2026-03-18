import './Dashboard.css'
import { useState, useEffect, useContext } from 'react'
import { AppContext } from '../../App.jsx';
import Timer from '../../Components/Timer/Timer.jsx';
import { Link } from 'react-router-dom';
import { msToPoints } from '../../utils/Helpers.js';
import Markdown from 'react-markdown';
import remarkWikiLink from 'remark-wiki-link';
import { v4 as uuid } from "uuid";

function Dashboard({ isTaskSession, setIsTaskSession }) {
  const [playerPoints, setPlayerPoints] = useState([]);
  const [todos, setTodos] = useState([]);
  const [durationPenalty, setDurationPenalty] = useState(null);
  const [draftTask, setDraftTask] = useState({});
  const [upcomingTodos, setUpcomingTodos] = useState(null);

  const databaseConnection = useContext(AppContext).databaseConnection;

  useEffect(() => {
    const reload = async () => {
      const players = await databaseConnection.getPlayers();

      const DataPromises = players.map(async (player) => {
        const tasks = await databaseConnection.getPlayerTasks(player.UUID);
        let sum = 0;
        tasks.forEach(task => { sum += (task.points || 0); });
        return { ...player, points: sum };
      });

      const results = await Promise.all(DataPromises);
      results.sort((a, b) => b.points - a.points);
      setPlayerPoints(results);

      const todoArray = await databaseConnection.getTodos();
      setTodos(todoArray);

      if (upcomingTodos === null && todoArray.length > 0) {
        const difficultyOrder = { hard: 3, medium: 2, easy: 1 };
        const todayStr = new Date().toLocaleDateString('sv');
        const dueTodayTasks = todoArray.filter(t => t.dueDate === todayStr);

        if (dueTodayTasks.length > 0) {
          dueTodayTasks.sort((a, b) => (difficultyOrder[b.difficulty] || 0) - (difficultyOrder[a.difficulty] || 0));
          setUpcomingTodos(dueTodayTasks[0]);
        } else {
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const weights = todoArray.map(t => {
            const dur = parseFloat(t.estimatedDuration) || 0;
            const buf = parseFloat(t.estimatedBuffer) || 0;
            const due = new Date(t.dueDate + 'T00:00:00');
            const daysUntilDue = Math.max((due - today) / 86400000, 1);
            return (dur + buf) / daysUntilDue;
          });

          const total = weights.reduce((sum, w) => sum + w, 0);

          if (total === 0) {
            setUpcomingTodos(todoArray[0]);
            return;
          }

          const scaled = weights.map(w => (w / total) * 100);
          const rng = 1 + Math.random() * 99;
          let remaining = rng;
          let selected = todoArray[todoArray.length - 1];

          for (let i = 0; i < scaled.length; i++) {
            remaining -= scaled[i];
            if (remaining <= 0) {
              selected = todoArray[i];
              break;
            }
          }

          setUpcomingTodos(selected);
        }
      }
    };
      reload();
  }, [databaseConnection, useContext(AppContext).timestamp])

  /* Helper Methods */

  const updateStates = (taskSession, durationPenalty, draftTask) => {
    setIsTaskSession(taskSession);
    setDurationPenalty(durationPenalty);
    setDraftTask(draftTask);
  };

  const getTaskDuration = () => {
    return draftTask.createdAt ? Date.now() - new Date(draftTask.createdAt).getTime() : 0;
  };

  const getTaskPoints = () => {
    return Math.floor(msToPoints(getTaskDuration()));
  };

  const handleTaskSubmit = async (e) => {
    e.preventDefault();
    const parent = await databaseConnection.getCurrentPlayer();

    databaseConnection.addPlayer({
      ...parent,
      tokens: Math.floor(parent.tokens + (msToPoints(getTaskDuration()) - durationPenalty) / 6)
    });

    const task = {
      ...draftTask,
      duration: getTaskDuration(),
      points: Math.floor(msToPoints(getTaskDuration()) - durationPenalty),
      UUID: uuid(),
      parent: parent.UUID,
      completedAt: new Date().toISOString()
    };

    await databaseConnection.addTaskLog(task);
    updateStates(false, null, {});
  };

  const handleTaskSubmitAndSave = async (e) => {
    e.preventDefault();
    const parent = await databaseConnection.getCurrentPlayer();

    const workedMinutes = getTaskDuration() / 60000;
    const originalDuration = parseFloat(draftTask.estimatedDuration) || 0;
    const remainingDuration = Math.max(originalDuration - workedMinutes, 0);

    const task = {
      ...draftTask,
      duration: getTaskDuration(),
      points: Math.floor(msToPoints(getTaskDuration()) - durationPenalty),
      UUID: uuid(),
      parent: parent.UUID,
      completedAt: new Date().toISOString()
    };

    await databaseConnection.addTaskLog(task);
    updateStates(false, null, { ...draftTask, estimatedDuration: remainingDuration });
  };

  const handleTodoSubmit = async (e) => {
    e.preventDefault();

    const task = {
      ...draftTask,
      createdAt: new Date().toISOString(),
      parent: parent.UUID,
      UUID: uuid(),
    };

    await databaseConnection.addTodoLog(task);
    const updatedTodos = await databaseConnection.getTodos();
    setTodos(updatedTodos);
    updateStates(false, null, {});
  };

  const handleStartTask = () => {
    const taskData = {
      ...draftTask,
      createdAt: new Date().toISOString(),
      localCreatedAt: new Date().toLocaleString('sv').replace(' ', 'T'),
    };
    updateStates(true, 0, taskData);
  };

  const handleGiveUpTask = async (e) => {
    e.target.form.reset();
    updateStates(false, 0, draftTask);
  };

  const handleBrokeFocus = async () => {
    const penalty = (getTaskPoints() - durationPenalty) / 2;
    setDurationPenalty(Math.floor(penalty + durationPenalty));
  };

  const handleGetNext = async () => {
    if (!upcomingTodos) return;
    await databaseConnection.removeTodoLog(upcomingTodos.UUID);
    setDraftTask(prev => ({
      ...prev,
      taskName: upcomingTodos.taskName,
      location: upcomingTodos.location,
      distractions: upcomingTodos.distractions,
      reasonToSelect: upcomingTodos.reasonToSelect,
      efficiency: upcomingTodos.efficiency,
      estimatedDuration: upcomingTodos.estimatedDuration,
      estimatedBuffer: upcomingTodos.estimatedBuffer,
      dueDate: upcomingTodos.dueDate,
      difficulty: upcomingTodos.difficulty,
    }));
    const todoArray = await databaseConnection.getTodos();
    setTodos(todoArray);
    setUpcomingTodos(null);
  };

  function RankListComponent() {
    return <div className="rank-list">
      <table className="rank-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Username</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          {playerPoints.map((element, index) => (
            <tr key={element.createdAt}>
              <td>{"#" + (index + 1)}</td>
              <td>
                <Link
                  to={`/profile/${element.UUID}`}
                  className={isTaskSession ? "disabled-link" : ""}>
                  {element.username}
                </Link>
              </td>
              <td>{element.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>;
  }

  function TaskDisplay() {
    function TaskInfoComponent() {
      if (!isTaskSession) {
        return <div className="task-form-inputs">
          <p>Task Creation</p>
          <div>
            <label>
              Task Name:
              <input type="text" name="taskName"
                value={draftTask.taskName || ""}
                onChange={e => setDraftTask(prev => ({ ...prev, taskName: e.target.value }))} />
            </label>
            <label>
              Why did you pick this task?
              <textarea name="reasonToSelect"
                value={draftTask.reasonToSelect || ""}
                onChange={e => setDraftTask(prev => ({ ...prev, reasonToSelect: e.target.value }))} />
            </label>
            <label>
              How will you use the time?
              <textarea name="efficiency"
                value={draftTask.efficiency || ""}
                onChange={e => setDraftTask(prev => ({ ...prev, efficiency: e.target.value }))} />
            </label>
            <label>
              Duration (min):
              <input type="number" name="estimatedDuration"
                value={draftTask.estimatedDuration || ""}
                onChange={e => setDraftTask(prev => ({ ...prev, estimatedDuration: e.target.value }))} />
            </label>
            <label>
              Buffer (min):
              <input type="number" name="estimatedBuffer"
                value={draftTask.estimatedBuffer || ""}
                onChange={e => setDraftTask(prev => ({ ...prev, estimatedBuffer: e.target.value }))} />
            </label>
            <label>
              Due Date:
              <input type="date" name="dueDate"
                value={draftTask.dueDate || ""}
                onChange={e => setDraftTask(prev => ({ ...prev, dueDate: e.target.value }))} />
            </label>
            <label>
              Difficulty:
              <select name="difficulty"
                value={draftTask.difficulty || ""}
                onChange={e => setDraftTask(prev => ({ ...prev, difficulty: e.target.value }))}>
                <option value="">Select...</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>
          </div>
        </div>;
      } else {
        return <div className="task-session-description">
          <div className="task-titlebar">
            <p>{draftTask.taskName}</p>
            <p>{draftTask.reasonToSelect}</p>
          </div>
          {draftTask.efficiency ?
            <>
              <p>Plan</p>
              <span>
                <p>
                  <Markdown remarkPlugins={[remarkWikiLink]}>{draftTask.efficiency}</Markdown>
                </p>
              </span>
            </>
            : ""
          }
        </div>;
      }
    }

    return <form action="" className="task-creation-menu" onSubmit={handleTaskSubmit}>
      {TaskInfoComponent()}
      {isTaskSession ?
        <div className="task-session-container">
          <Timer startTime={new Date(draftTask.localCreatedAt).getTime()} duration={draftTask.estimatedDuration} buffer={draftTask.estimatedBuffer} durationPenalty={durationPenalty} />
          <div className="task-session-buttons">
            <button type="button" onClick={handleTaskSubmitAndSave}>⎋</button>
            <button>Complete</button>
            <button type="button" onClick={handleBrokeFocus}>Broke Focus</button>
            <button type="button" onClick={handleGiveUpTask}>End Attempt</button>
          </div>
        </div> :
        <div className="task-planning-buttons">
          <button onClick={handleStartTask} className="task-form-buttons" type="button" disabled={draftTask.taskName ? false : true}>Start</button>
          <button className="task-form-buttons" onClick={handleTodoSubmit} disabled={draftTask.taskName ? false : true}>Store</button>
        </div>
      }
    </form>;
  }

  const handleSelectTodo = async (todo) => {
    await databaseConnection.removeTodoLog(todo.UUID);
    setDraftTask(prev => ({
      ...prev,
      taskName: todo.taskName,
      location: todo.location,
      distractions: todo.distractions,
      reasonToSelect: todo.reasonToSelect,
      efficiency: todo.efficiency,
      estimatedDuration: todo.estimatedDuration,
      estimatedBuffer: todo.estimatedBuffer,
      dueDate: todo.dueDate,
      difficulty: todo.difficulty,
    }));
    const todoArray = await databaseConnection.getTodos();
    setTodos(todoArray);
  };

  function TodoFormComponent() {
    return <div className="todo-section">
      <div className="todo-header-actions">
        <button className="get-next-btn" type="button" onClick={handleGetNext} disabled={!upcomingTodos}>
          Get Next
        </button>
      </div>
      <div className="todo-creation-menu">
        <p>Todo List</p>
        <ul>
          {todos.map((element) => (
            <li
              key={element.createdAt}
              onClick={() => handleSelectTodo(element)}
              style={{ cursor: "pointer" }}>
              {element.taskName}
            </li>
          ))}
        </ul>
      </div>
    </div>;
  }

  return <div className="dashboard">
    {TaskDisplay()}
    {RankListComponent()}
    {TodoFormComponent()}
  </div>;
}

export default Dashboard;