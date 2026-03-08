import './Dashboard.css'
import { useState, useEffect, useContext } from 'react'
import { DatabaseConnectionContext } from '../../App.jsx';
import Timer from '../../components/Timer/Timer.jsx';
import { Link } from 'react-router-dom';
import { msToPoints } from '../../Helpers.js';
import Markdown from 'react-markdown';
import remarkWikiLink from 'remark-wiki-link';
import { v4 as uuid } from "uuid";

/** 
  * Contains Rank, Todo List, and Input Task Form 
  * @param {boolean} isTaskSession
  * @param {function} setIsTaskSession
*/
function Dashboard({ isTaskSession, setIsTaskSession }) {
  /*Internal Data*/
  const [playerPoints, setPlayerPoints] = useState([]);
  const [todos, setTodos] = useState([]);

  //convert duration penalty into an object
  const [durationPenalty, setDurationPenalty] = useState(null);
  const [draftTask, setDraftTask] = useState({});

  const databaseConnection = useContext(DatabaseConnectionContext);

  useEffect(() => {
    const loadPlayers = async () => {
      const players = await databaseConnection.getPlayers();

      const DataPromises = players.map(async (player) => {
        const tasks = await databaseConnection.getRelativePlayerTasks(player)
        

        let sum = 0;
        tasks.forEach(task => {
          sum += (task.points || 0);
        });

        return {
          ...player,
          points: sum,
        };
      }
    );
      const results = await Promise.all(DataPromises);
      results.sort((a, b) => b.points - a.points);
      setPlayerPoints(results);
      
      const todoArray = await databaseConnection.getIncompleteTasks();
      setTodos(todoArray);
    };
      loadPlayers();
  }, [databaseConnection, isTaskSession])

  /* Helper Methods */

  /**
   * @param {boolean} taskSession
   * @param {number} durationPenalty
   * @param {object} draftTask
   */
  const updateStates = (taskSession, durationPenalty, draftTask) => {
    //updating these states typically happen concurrently (on switch between isTaskSession)
    setIsTaskSession(taskSession); 
    setDurationPenalty(durationPenalty);
    setDraftTask(draftTask);
  }

  const getTaskDuration = () => {
    return draftTask.createdAt ? Date.now() - new Date(draftTask.createdAt).getTime() : 0;
  }

  const getTaskPoints = () => {
    //might remove and replace its calls with just msToPoints(getTaskDuration());
    const duration = getTaskDuration();
    return Math.floor(msToPoints(duration));
  }

  //task submission, large chunk of code is duplicate see if we can merge
  const handleTaskSubmit = async (e) => {
    e.preventDefault();

    const localCompletedAt = new Date().toLocaleString('sv').replace(' ', 'T')
    const parent = await databaseConnection.getPlayer(localCompletedAt.split("T")[0] + "T00:00:00")

    const task = {
      ...draftTask,
      duration: getTaskDuration(),  
      points: Math.floor(msToPoints(getTaskDuration()) - durationPenalty),
      localCompletedAt: new Date().toLocaleString('sv').replace(' ', 'T'),
      UUID: uuid(),
      parent: parent.UUID
    }

    await databaseConnection.addTaskLog(task);

    updateStates(false, null, {})
    e.target.reset();
  }

  const handleTaskSubmitAndSave = async (e) => {
    e.preventDefault();

    const localCompletedAt = new Date().toLocaleString('sv').replace(' ', 'T')
    const parent = await databaseConnection.getPlayer(localCompletedAt.split("T")[0] + "T00:00:00")

    const task = {
      ...draftTask,
      duration: getTaskDuration(),  
      points: Math.floor(msToPoints(getTaskDuration()) - durationPenalty),
      localCompletedAt: new Date().toLocaleString('sv').replace(' ', 'T'),
      UUID: uuid(),
      parent: parent.UUID
    }

    await databaseConnection.addTaskLog(task);

    updateStates(false, null, draftTask)
    e.target.reset();
  }

  const handleTodoSubmit = async (e) => {
    e.preventDefault();

    const task = {
      ...draftTask,
      createdAt: new Date().toISOString(),
      localCreatedAt: new Date().toLocaleString('sv').replace(' ', "T"),
    }

    await databaseConnection.addTaskLog(task);

    const updatedTodos = await databaseConnection.getIncompleteTasks();
    setTodos(updatedTodos);

    updateStates(false, null, {});

    e.target.reset();
  }

  const handleStartTask = () => {
    const taskData = {
      ...draftTask,
      createdAt: new Date().toISOString(),
      localCreatedAt: new Date().toLocaleString('sv').replace(' ', "T"),
    }

    updateStates(true, 0, taskData);
  }

  const handleGiveUpTask = async (e) => {
    e.target.form.reset();
    updateStates(false, 0, draftTask);
  }

  const handleBrokeFocus = async() => {
    //applies penalty that divides your points by 2 up to this point
    const penalty = (getTaskPoints() - durationPenalty) / 2;
    setDurationPenalty(Math.floor(penalty + durationPenalty));
  }

  /* Components */

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
          {
            playerPoints.map((element, index) => (
              <tr key={element.createdAt}>
                <td>{"#" + (index + 1)}</td>
                <td>
                  <Link 
                    to={`/profile/${element.localCreatedAt}`}
                    className={isTaskSession ? "disabled-link" : ""}>
                    {element.username}
                  </Link>
                </td>
                <td>{element.points}</td>
              </tr>))
          }
        </tbody>
      </table>
    </div>
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
              onChange={e => setDraftTask(prev => ({ ...prev, taskName: e.target.value }))}/>
            </label>
            <label>
              Why did you pick this task?
              <textarea name="reasonToSelect"
              value={draftTask.reasonToSelect || ""}
              onChange={e => setDraftTask(prev => ({ ...prev, reasonToSelect: e.target.value }))}/>
            </label>
            <label>
              How will you use the time?
              <textarea name="efficiency"
              value={draftTask.efficiency || ""}
              onChange={e => setDraftTask(prev => ({ ...prev, efficiency: e.target.value }))}/>
            </label>
            <label>
              Duration (min):
              <input type="number" name="estimatedDuration"
              value={draftTask.estimatedDuration || ""}
              onChange={e => setDraftTask(prev => ({ ...prev, estimatedDuration: e.target.value }))}/>
            </label>
            <label>
              Buffer (min):
              <input type="number" name="estimatedBuffer"
              value={draftTask.estimatedBuffer || ""}
              onChange={e => setDraftTask(prev => ({ ...prev, estimatedBuffer: e.target.value }))}/>
            </label>
          </div>
        </div>
    }else {
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
      </div>
    }
  }
    return <form action="" className="task-creation-menu"
      onSubmit={handleTaskSubmit}>
        {TaskInfoComponent()}
      {
        isTaskSession ? 
        <div className="task-session-container">
          <Timer startTime={new Date(draftTask.localCreatedAt).getTime()} duration={draftTask.estimatedDuration} buffer={draftTask.estimatedBuffer} durationPenalty={durationPenalty}/> 
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
    </form>
  }

  const handleSelectTodo = async (todo) => {
    //review
    await databaseConnection.removeTaskLog(todo.localCreatedAt); 

    const todoArray = await databaseConnection.getIncompleteTasks();
    setTodos(todoArray);
    
    setDraftTask(prev => ({
      ...prev,
      taskName: todo.taskName,
      location: todo.location,
      distractions: todo.distractions,
      reasonToSelect: todo.reasonToSelect,
      efficiency: todo.efficiency,
      estimatedDuration: todo.estimatedDuration,
      estimatedBuffer: todo.estimatedBuffer,
    })
  );
};

  function TodoFormComponent() {
    return <div className="todo-creation-menu">
      <p>Todo List</p>
      <ul>
        {//REVIEW
        todos.map((element) => ( 
          <li
            key={element.createdAt}
            onClick={() => handleSelectTodo(element)}
            style={{ cursor: "pointer" }}>
            {element.taskName}
          </li>
        ))}
      </ul>
    </div>
  }

  return <div className="dashboard">
    {TaskDisplay()}
    {RankListComponent()}
    {TodoFormComponent()}
  </div>
}

export default Dashboard;