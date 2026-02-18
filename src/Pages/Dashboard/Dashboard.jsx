import './Dashboard.css'
import { useState, useEffect, useContext, useMemo } from 'react'
import { DatabaseConnectionContext } from '../../App.jsx';
import TaskDatabase from '../../network/Database/TaskDatabase.js';
import PlayerDatabase from '../../network/Database/PlayerDatabase.js';
import Stopwatch from '../../components/Stopwatch/Stopwatch.jsx';
import { Link } from 'react-router-dom';

//pass along whether a task session is currently active
function Dashboard({ inTaskSession, setInTaskSession }) {

  function TaskMenu() {
    return <form action="" className="task-creation-menu"
      onSubmit={handleSubmit}>
        {TaskDescription()}
      {
        inTaskSession ? 
        <div className="task-session-container">
          <div className="task-form-buttons">
            <button>Complete</button>
            <button type="button" onClick={handleBrokeFocus}>Broke Focus</button>
            <button type="button" onClick={handleGiveUpTask}>Give Up</button>
          </div>
          <Stopwatch startTime={taskStartTime} durationPenalty={durationPenalty}/> 
          
        </div>
        : <button onClick={handleStartTask} className="task-form-buttons" type="button" disabled={taskInputsFilled() ? false : true}>Start</button>
      }
    </form>
  }

  function RankDisplay() {
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
                  className={inTaskSession ? "disabled-link" : ""}>
                  {element.username}
                  </Link></td>
                <td>{element.points}</td>
              </tr>))
          }
        </tbody>
      </table>
    </div>
  }

  function TaskDescription() {
    if (!inTaskSession) {
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

  const databaseConnection = useContext(DatabaseConnectionContext);
  const taskDatabase = useMemo(
    () => new TaskDatabase(databaseConnection)
    ,[databaseConnection]
  );
  const playerDatabase = useMemo(
    () => new PlayerDatabase(databaseConnection),
    [databaseConnection]
  );
  
  //First fetch all the players, then use getTasksFromRange for each player and sum up the points. We discard the actual task object after we calculate total # of tasks so at most like 100 tasks in memory at a time before being reduced to a integer.
  const [playerPoints, setPlayerPoints] = useState([]);
  const [taskStartTime, setTaskStartTime] = useState(null);
  const [durationPenalty, setDurationPenalty] = useState(null);
  const [draftTask, setDraftTask] = useState({});


  useEffect(() => { //review method
    //**loads all players** and adds task totals every call. 
    //"async/await in forEach" / "the JavaScript forEach async trap."
    //understand ISOString and Date
    const loadPlayers = async () => {
      const players = await playerDatabase.getPlayers()

      const playerPointsPromises = players.map(async (player) => {
        const lastMidnight = new Date(new Date().toLocaleString('sv').split(' ')[0] + "T00:00:00");
        const currentTime = new Date(new Date().toLocaleString('sv').replace(' ', "T"));
        const msElapsedSinceStart = currentTime - lastMidnight;

        const startDate = player.localCreatedAt;
        const endDate = (new Date(new Date(player.localCreatedAt).getTime() + msElapsedSinceStart)).toISOString();

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
   
  }, [playerDatabase, inTaskSession])

  const getTaskDuration = () => {
    return taskStartTime ? Date.now() - taskStartTime : 0;
  }

  const taskInputsFilled = (e) => {
    return draftTask.taskName && draftTask.location &&
    draftTask.distractions && draftTask.reasonToSelect && draftTask.efficiency &&
    draftTask.estimatedDuration && draftTask.estimatedBuffer;
  }

  const getTaskPoints = () => {
    return Math.floor(getTaskDuration() / 10000);
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    const task = {
      ...draftTask,
      duration: getTaskDuration(),  
      points: Math.floor(getTaskPoints() - durationPenalty)
    }

    await taskDatabase.addTaskLog(task);

    setInTaskSession(false); // Reset the start time
    setTaskStartTime(null);  
    setDurationPenalty(null);
    setDraftTask({});
    e.target.reset();
  }


  const handleStartTask = (e) => {
    const taskData = {
      ...draftTask,
      createdAt: new Date().toISOString(),
      localCreatedAt: new Date().toLocaleString('sv').replace(' ', 'T') + '.000',
    }

    setInTaskSession(true); //changes visual menu
    setTaskStartTime(Date.now());  // Record when task started
    setDurationPenalty(0);
    setDraftTask(taskData);
  }

  const handleGiveUpTask = async (e) => {
    e.target.form.reset();
    setInTaskSession(false);
    setTaskStartTime(null);  // Reset start time when giving up
    setDurationPenalty(0);
    setDraftTask({});
  }

  const handleBrokeFocus = async(e) => {
    const penalty = (getTaskPoints() - durationPenalty) / 2;
    setDurationPenalty(Math.floor(penalty + durationPenalty));
    //uses old value of durationpenalty for console log (to simulate fix that)
  }

  return <div className="dashboard">
    {TaskMenu()}
    {RankDisplay()}
  </div>
}

export default Dashboard;