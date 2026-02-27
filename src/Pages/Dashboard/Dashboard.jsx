import './Dashboard.css'
import { useState, useEffect, useContext, useMemo } from 'react'
import { DatabaseConnectionContext } from '../../App.jsx';
import TaskDatabase from '../../network/Database/TaskDatabase.js';
import PlayerDatabase from '../../network/Database/PlayerDatabase.js';
import Stopwatch from '../../components/Stopwatch/Stopwatch.jsx';
import { Link } from 'react-router-dom';
import { getLocalDateAtMidnight, getLocalDate, addDurationToUTCString, msToPoints } from '../../Helpers.js';

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
  
  const taskDatabase = useMemo(
    () => new TaskDatabase(databaseConnection)
    ,[databaseConnection]
  );
  const playerDatabase = useMemo(
    () => new PlayerDatabase(databaseConnection),
    [databaseConnection]
  );

  useEffect(() => {
    const loadPlayers = async () => {
      const players = await playerDatabase.getPlayers()

      const playerPointsPromises = players.map(async (player) => {
        const lastMidnight = getLocalDateAtMidnight();
        const currentTime = getLocalDate();
        const msElapsed = currentTime - lastMidnight;

        //grabs the tasks for each player between their respective midnight + duration since current days midnight
        //allows syncronous gameplay
        const startDate = player.localCreatedAt;
        const endDate = (addDurationToUTCString(player.localCreatedAt, msElapsed)).toISOString();

        const tasks = await taskDatabase.getTasksFromRange(startDate, endDate);

        let sum = 0;
        tasks.forEach(task => {
          sum += (task.points || 0);
        });

        return {
          ...player,
          points: sum,
          tasks: tasks
        };
      }
    );
      const results = await Promise.all(playerPointsPromises);
      results.sort((a, b) => b.points - a.points);
      setPlayerPoints(results);
    };
      loadPlayers();
  }, [playerDatabase, isTaskSession])

  /* Helper Methods */

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

    await taskDatabase.addTaskLog(task);

    setIsTaskSession(false); 
    setDurationPenalty(null);
    setDraftTask({});
    e.target.reset();
  }

  const handleStartTask = () => {
    const taskData = {
      ...draftTask,
      createdAt: new Date().toISOString(),
      localCreatedAt: getLocalDate(),
    }

    setIsTaskSession(true); 
    setDurationPenalty(0);
    setDraftTask(taskData);
  }

  const handleGiveUpTask = async (e) => {
    e.target.form.reset();
    setIsTaskSession(false);
    setDurationPenalty(0);
    setDraftTask({});
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
                <td><Link 
                  to="/profile"
                  state={{ player: element }}
                  className={isTaskSession ? "disabled-link" : ""}>
                  {element.username}
                  </Link></td>
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