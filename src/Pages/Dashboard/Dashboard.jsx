import './Dashboard.css'
import { useState, useEffect, useContext } from 'react'
import { DatabaseConnectionContext } from '../../App.jsx';
import Stopwatch from '../../components/Stopwatch/Stopwatch.jsx';
import { Link } from 'react-router-dom';
import { getLocalDate, msToPoints } from '../../Helpers.js';

/** 
  * Contains Rank, Todo List, and Input Task Form 
  * @param {boolean} isTaskSession
  * @param {function} setIsTaskSession
*/
function Dashboard({ isTaskSession, setIsTaskSession }) {
  /*Internal Data*/
  const [playerPoints, setPlayerPoints] = useState([]);

  //convert duration penalty into an object
  const [durationPenalty, setDurationPenalty] = useState(null);
  const [draftTask, setDraftTask] = useState({});

  const databaseConnection = useContext(DatabaseConnectionContext);

  useEffect(() => {
    const loadPlayers = async () => {
      const players = await databaseConnection.getPlayers()

      const playerPointsPromises = players.map(async (player) => {
        const tasks = await databaseConnection.getRelativePlayerTasks(player)

        let sum = 0;
        tasks.forEach(task => {
          sum += (task.points || 0);

          //todos are tasks without a defined duration. 
          //Patchwork gathering method works with the assumption there has to be a player to create a task.
          //Therefore, for each day, if any tasks exist with zero completions, it is a todo.

          
        });

        return {
          ...player,
          points: sum,
        };
      }
    );
      const results = await Promise.all(playerPointsPromises);
      results.sort((a, b) => b.points - a.points);
      setPlayerPoints(results);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    const task = {
      ...draftTask,
      duration: getTaskDuration(),  
      points: Math.floor(msToPoints(getTaskDuration()) - durationPenalty)
    }

    await databaseConnection.addTaskLog(task);

    updateStates(false, null, {})
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
    updateStates(false, 0, {});
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

  function TaskFormComponent() {
    function TaskInputs() {
    if (!isTaskSession) {
      return <div className="form-inputs">
          <label>
            Task Name:
            <input type="text" name="taskName" 
            onChange={e => setDraftTask(prev => ({ ...prev, taskName: e.target.value }))}/>
          </label>
          <label>
            Why work here?
            <input type="text" name="location"
            onChange={e => setDraftTask(prev => ({ ...prev, location: e.target.value }))}/>
          </label>
          <label>
            Where are your distractions?
            <input type="text" name="distractions"
            onChange={e => setDraftTask(prev => ({ ...prev, distractions: e.target.value }))}/>
          </label>
          <label>
            Why did you pick this task?
            <textarea name="reasonToSelect"
            onChange={e => setDraftTask(prev => ({ ...prev, reasonToSelect: e.target.value }))}/>
          </label>
          <label>
            How will you be efficient?
            <textarea name="efficiency"
            onChange={e => setDraftTask(prev => ({ ...prev, efficiency: e.target.value }))}/>
          </label>
          <label>
            Est. Duration (minutes):
            <input type="number" name="estimatedDuration"
            onChange={e => setDraftTask(prev => ({ ...prev, estimatedDuration: e.target.value }))}/>
          </label>
          <label>
            Est. Buffer (minutes):
            <input type="number" name="estimatedBuffer"
            onChange={e => setDraftTask(prev => ({ ...prev, estimatedBuffer: e.target.value }))}/>
          </label>
        </div>
    }else {
      return <div className="form-inputs">
        <div>
          <span>{draftTask.taskName}</span>
          <div>
            <span>{"Purpose: " + draftTask.reasonToSelect}</span>
            <span>{"Plan: " + draftTask.efficiency}</span>
            <span>{"Goal Duration: " + draftTask.estimatedDuration + "m with " + draftTask.estimatedBuffer + "m Buffer"}</span>
          </div>
        </div>
      </div>
    }
  }
    return <form action="" className="task-creation-menu"
      onSubmit={handleSubmit}>
        {TaskInputs()}
      {
        isTaskSession ? 
        <div className="task-session-container">
          <div className="task-form-buttons">
            <button>Complete</button>
            <button type="button" onClick={handleBrokeFocus}>Broke Focus</button>
            <button type="button" onClick={handleGiveUpTask}>Give Up</button>
          </div>
          <Stopwatch startTime={new Date(draftTask.localCreatedAt).getTime()} durationPenalty={durationPenalty}/> 
          
        </div>
        : <button onClick={handleStartTask} className="task-form-buttons" type="button" disabled={draftTask.taskName ? false : true}>Start</button>
      }
    </form>
  }

  return <div className="dashboard">
    {TaskFormComponent()}
    {RankListComponent()}
    <ul>
      <li>Morning Routine (6 am)</li>
      <li>Do Schoolwork</li>
      <li>Extracurriculars</li>
      <li>Jot down plans for everything incomplete / on your mind</li>
      <li>Free Time</li>
      <li>Journal</li>
      <li>Night Routine (10 pm)</li>
    </ul>
  </div>
}

export default Dashboard;