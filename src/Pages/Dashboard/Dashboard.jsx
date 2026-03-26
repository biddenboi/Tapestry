import './Dashboard.css'
import { useState, useEffect, useContext } from 'react'
import { AppContext } from '../../App.jsx';
import Timer from '../../Components/Timer/Timer.jsx';
import { msToPoints } from '../../utils/Helpers/Time.js';
import Markdown from 'react-markdown';
import remarkWikiLink from 'remark-wiki-link';
import { v4 as uuid } from "uuid";
import { DAY, MINUTE, STORES } from '../../utils/Constants.js'
import { endWorkDay } from '../../utils/Helpers/Events.js';
import { getCurrentLocation } from '../../utils/Helpers/Location.js'
import { getTaskDuration } from '../../utils/Helpers/Tasks.js'
import RankListComponent from '../../Components/Ranklist/Ranklist.jsx';

/** 
  * Contains Rank, Todo List, and Input Task Form 
  * @param {boolean} isTaskSession
  * @param {function} setIsTaskSession
*/
function Dashboard({ isTaskSession, setIsTaskSession }) {
  /*Internal Data*/
  
  const [todos, setTodos] = useState([]);
  const [nextTodo, setNextTodo] = useState(null);

  const [draftTask, setDraftTask] = useState({});

  const databaseConnection = useContext(AppContext).databaseConnection;

  useEffect(() => {
    const reload = async () => {
      
      const todoArray = await databaseConnection.getAll(STORES.todo);
      setTodos(todoArray);

      //check if nextTodo has not been used yet
      if (nextTodo != null || todoArray.length === 0) return;

      //creating object enum to handle sorting
      const difficultyOrder = { hard: 3, medium: 2, easy: 1};

      //SVT returns YYYY-MM-DD
      const todayStr = new Date().toLocaleDateString('sv');
      const dueTodayTasks = todoArray.filter(t => t.dueDate === todayStr);

      if (dueTodayTasks.length > 0) {
        dueTodayTasks.sort((a, b) => (difficultyOrder[b.difficulty] || 0) - (difficultyOrder[a.difficulty] || 0));
        setNextTodo(dueTodayTasks[0]);
      } else {
        const today = new Date();

        //maybe remove this line so more granular time controls are possible.
        today.setHours(0, 0, 0, 0);

        const weights = todoArray.map(t => {
          const dur = parseFloat(t.estimatedDuration) || 0;
          const buf = parseFloat(t.estimatedBuffer) || 0;
          const due = new Date(t.dueDate + 'T00:00:00');

          const daysUntilDue = Math.max((due - today) / DAY, 1);
          return (dur + buf) / daysUntilDue;
        });

        const total = weights.reduce((sum, w) => sum + w, 0);

        if (total === 0) {
          setNextTodo(todoArray[0]);
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

        setNextTodo(selected);
      }
    }
    reload();
  }, [databaseConnection, useContext(AppContext).timestamp, isTaskSession])

  /* Helper Methods */

  /**
   * @param {boolean} taskSession
   * @param {number} durationPenalty
   * @param {object} draftTask
   */
  const updateStates = (taskSession, draftTask) => {
    //updating these states typically happen concurrently (on switch between isTaskSession)
    setIsTaskSession(taskSession); 
    setDraftTask(draftTask);
  }

  //task submission, large chunk of code is duplicate see if we can merge
  const handleTaskSubmit = async (e) => {
    e.preventDefault();

    const parent = await databaseConnection.getCurrentPlayer();

    const task = {
      ...draftTask,
      points: null,
      UUID: uuid(),
      parent: parent.UUID,
      completedAt: new Date().toISOString(),
      location: null
    }

    const duration = getTaskDuration(task);
    task.points = Math.floor(msToPoints(getTaskDuration(task)));
    
    //temporary, creates token every minute
    databaseConnection.add(STORES.player, {
      ...parent,
      tokens: Math.floor(parent.tokens + (msToPoints(duration)) / 6)
    })

    await databaseConnection.add(STORES.task, task);

    updateStates(false, {})

    //note - revise maybe into seperate method?
    getCurrentLocation()
      .then(async (location) => {
        if (!location) return;

        await databaseConnection.add(STORES.transaction, {
          ...transaction,
          location,
        });
      })
      .catch((err) => {
        console.error("Background location update failed:", err);
      });
  }

  const handleTaskSubmitAndSave = async (e) => {
    e.preventDefault();

    const task = {
      ...draftTask,
      points: null,
      UUID: uuid(),
      parent: parent.UUID,
      completedAt: new Date().toISOString(),
      location: null
    }

    const duration = getTaskDuration(task);
    task.points = Math.floor(msToPoints(getTaskDuration(task)));

    draftTask.estimatedDuration -= Math.floor(duration/MINUTE);

    //temporary, creates token every minute
    databaseConnection.add(STORES.player, {
      ...parent,
      tokens: Math.floor(parent.tokens + (msToPoints(duration)) / 6)
    })

    await databaseConnection.add(STORES.task, task);

    updateStates(false, draftTask)

    //note - revise maybe into seperate method?
    getCurrentLocation()
      .then(async (location) => {
        if (!location) return;

        await databaseConnection.add(STORES.transaction, {
          ...transaction,
          location,
        });
      })
      .catch((err) => {
        console.error("Background location update failed:", err);
      });
  }

  //temporary method to log free for now transactions 
  const handleLogTransaction = async (e) => {
    e.preventDefault();

    const parent = await databaseConnection.getCurrentPlayer();
    const transactionId = uuid();

    const transaction = {
      name: draftTask.taskName,
      createdAt: draftTask.createdAt,
      UUID: transactionId,
      parent: parent.UUID,
      completedAt: new Date().toISOString(),
      location: null,
    };

    await databaseConnection.add(STORES.transaction, transaction);

    updateStates(false, {});

    //note - revise maybe into seperate method?
    getCurrentLocation()
      .then(async (location) => {
        if (!location) return;

        await databaseConnection.add(STORES.transaction, {
          ...transaction,
          location,
        });
      })
      .catch((err) => {
        console.error("Background location update failed:", err);
      });
  };

  const handleTodoSubmit = async (e) => {
    e.preventDefault();

    const todo = {
      ...draftTask,
      createdAt: new Date().toISOString(),
      parent: parent.UUID,
      UUID: uuid(),
    }

    await databaseConnection.add(STORES.todo, todo);

    //potentially comment out see if updating state still occurs
    const updatedTodos = await databaseConnection.getAll(STORES.todo);
    setTodos(updatedTodos);

    updateStates(false, {});
  }

  const handleStartTask = () => {
    const taskData = {
      ...draftTask,
      createdAt: new Date().toISOString(),
      localCreatedAt: new Date().toLocaleString('sv').replace(' ', "T"),
    }

    updateStates(true, taskData);
  }

  const handleGiveUpTask = async (e) => {
    e.target.form.reset();
    updateStates(false, draftTask);
  }

  const handleEndWorkDay = async () => {
    const currentPlayer = await databaseConnection.getCurrentPlayer();
    endWorkDay(databaseConnection, currentPlayer)
  }

  function TaskDisplay() {
    function TaskInfoComponent() {
    if (!isTaskSession) {
      return <div className="task-form-inputs">
        <div className="button-bar">
          <button
            type="button" onClick={handleEndWorkDay}
            >End Workday</button>
          <button onClick={() => handleGetNextTodo()} 
            disabled={!nextTodo}
            type="button">Get Next Todo</button>
        </div>
        <p>Task Creation</p>
          <div className="inputs">
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
            <label>
              Due Date:
              <input type="date" name="dueDate"
              value={draftTask.dueDate || ""}
              onChange={e => setDraftTask(prev => ({ ...prev, dueDate: e.target.value }))}/>
            </label>
            <label>
              Difficulty:
              <select name="difficulty"
                value={draftTask.difficulty || ""}
                onChange={e => setDraftTask(prev => ({ ...prev, difficulty: e.target.value }))}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
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
              <Markdown remarkPlugins={[remarkWikiLink]}>{draftTask.efficiency}</Markdown>
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
          <Timer startTime={new Date(draftTask.localCreatedAt).getTime()} duration={draftTask.estimatedDuration} buffer={draftTask.estimatedBuffer}/> 
          <div className="task-session-buttons">
            <button type="button" onClick={handleTaskSubmitAndSave}>⎋</button>
            <button>Complete</button>

            {/**temporary button just to hold off on breaks until shop is implemented */}
            <button type="button" onClick={handleLogTransaction}>Zero Log</button>

            {/**<button type="button" onClick={handleBrokeFocus}>Broke Focus</button>*/}
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
      })
    );

    await databaseConnection.remove(STORES.todo, todo.UUID); 

    const todoArray = await databaseConnection.getAll(STORES.todo);
    setTodos(todoArray);
  };

  const handleGetNextTodo = async () => {
        //review
    
    setDraftTask(prev => ({
      ...prev,
      taskName: nextTodo.taskName,
      location: nextTodo.location,
      distractions: nextTodo.distractions,
      reasonToSelect: nextTodo.reasonToSelect,
      efficiency: nextTodo.efficiency,
      estimatedDuration: nextTodo.estimatedDuration,
      estimatedBuffer: nextTodo.estimatedBuffer,
      dueDate: nextTodo.dueDate,
      difficulty: nextTodo.difficulty,
      })
    );

    await databaseConnection.remove(STORES.todo, nextTodo.UUID); 
    setNextTodo(null);

    const todoArray = await databaseConnection.getAll(STORES.todo);
    setTodos(todoArray);
  }

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