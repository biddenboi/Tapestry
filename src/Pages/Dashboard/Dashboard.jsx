import './Dashboard.css'
import { useState, useEffect, useContext, act } from 'react'
import { AppContext } from '../../App.jsx';
import Timer from '../../Components/Timer/Timer.jsx';
import { msToPoints } from '../../utils/Helpers/Time.js';
import Markdown from 'react-markdown';
import remarkWikiLink from 'remark-wiki-link';
import { v4 as uuid } from "uuid";
import { DAY, MINUTE, STORES } from '../../utils/Constants.js'
import { endWorkDay } from '../../utils/Helpers/Events.js';
import { getCurrentLocation } from '../../utils/Helpers/Location.js'
import { getMostUrgent, getTaskDuration } from '../../utils/Helpers/Tasks.js'
import RankListComponent from '../../Components/Ranklist/Ranklist.jsx';

/** 
  * Contains Rank, Todo List, and Input Task Form 
*/
function Dashboard() {
  /*Internal Data*/
  
  const [todos, setTodos] = useState([]);
  const [nextTodo, setNextTodo] = useState(null);

  //via reference
  const [activeTask, setActiveTask] = useContext(AppContext).activeTask;

  const databaseConnection = useContext(AppContext).databaseConnection;

  useEffect(() => {
    const reload = async () => {
      const todoArray = await databaseConnection.getAll(STORES.todo);
      setTodos(todoArray);

      //check if nextTodo has not been used yet
      if (nextTodo != null || todoArray.length === 0) return;
      setNextTodo(getMostUrgent(todoArray));

    }
    reload();
  }, [databaseConnection, useContext(AppContext).timestamp, activeTask])

  /* Helper Methods */

  /**
   * @param {boolean} taskSession
   * @param {number} durationPenalty
   * @param {object} activeTask
   */

  useEffect(() => {

  }, [activeTask])

  //task submission, large chunk of code is duplicate see if we can merge
  const handleTaskSubmit = async (e) => {
    e.preventDefault();

    const parent = await databaseConnection.getCurrentPlayer();

    const task = {
      ...activeTask,
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

    setActiveTask({});

    //note - revise maybe into seperate method?
    getCurrentLocation()
      .then(async (location) => {
        if (!location) return;

        await databaseConnection.add(STORES.task, {
          ...task,
          location,
        });
      })
      .catch((err) => {
        console.error("Background location update failed:", err);
      });
  }

  const handleTaskSubmitAndSave = async (e) => {
    e.preventDefault();

    const parent = await databaseConnection.getCurrentPlayer();

    const task = {
      ...activeTask,
      points: null,
      UUID: uuid(),
      parent: parent.UUID,
      completedAt: new Date().toISOString(),
      location: null
    }

    const duration = getTaskDuration(task);
    task.points = Math.floor(msToPoints(getTaskDuration(task)));

    activeTask.estimatedDuration -= Math.floor(duration/MINUTE);

    //temporary, creates token every minute
    databaseConnection.add(STORES.player, {
      ...parent,
      tokens: Math.floor(parent.tokens + (msToPoints(duration)) / 6)
    })

    await databaseConnection.add(STORES.task, task);

    setActiveTask({...activeTask, createdAt: null});

    //note - revise maybe into seperate method?
    getCurrentLocation()
      .then(async (location) => {
        if (!location) return;

        await databaseConnection.add(STORES.task, {
          ...task,
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

    const transaction = {
      name: activeTask.taskName,
      createdAt: activeTask.createdAt,
      UUID: uuid(),
      parent: parent.UUID,
      completedAt: new Date().toISOString(),
      location: null,
    };

    await databaseConnection.add(STORES.transaction, transaction);

    setActiveTask({});

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
      ...activeTask,
      createdAt: new Date().toISOString(),
      parent: parent.UUID,
      UUID: uuid(),
    }

    await databaseConnection.add(STORES.todo, todo);

    //potentially comment out see if updating state still occurs
    const updatedTodos = await databaseConnection.getAll(STORES.todo);
    setTodos(updatedTodos);

    setActiveTask({});
  }

  const handleStartTask = () => {
    const taskData = {
      ...activeTask,
      createdAt: new Date().toISOString(),
    }

    setActiveTask(taskData);
  }

  const handleGiveUpTask = async (e) => {
    e.target.form.reset();
    setActiveTask({...activeTask, createdAt: null});
  }

  const handleEndWorkDay = async () => {
    const currentPlayer = await databaseConnection.getCurrentPlayer();
    endWorkDay(databaseConnection, currentPlayer)
  }

  function TaskDisplay() {
    function TaskInfoComponent() {
    if (activeTask.createdAt == null) {
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
              value={activeTask.taskName || ""}
              onChange={e => setActiveTask(prev => ({ ...prev, taskName: e.target.value }))}/>
            </label>
            <label>
              Why did you pick this task?
              <textarea name="reasonToSelect"
              value={activeTask.reasonToSelect || ""}
              onChange={e => setActiveTask(prev => ({ ...prev, reasonToSelect: e.target.value }))}/>
            </label>
            <label>
              How will you use the time?
              <textarea name="efficiency"
              value={activeTask.efficiency || ""}
              onChange={e => setActiveTask(prev => ({ ...prev, efficiency: e.target.value }))}/>
            </label>
            <label>
              Duration (min):
              <input type="number" name="estimatedDuration"
              value={activeTask.estimatedDuration || ""}
              onChange={e => setActiveTask(prev => ({ ...prev, estimatedDuration: e.target.value }))}/>
            </label>
            <label>
              Buffer (min):
              <input type="number" name="estimatedBuffer"
              value={activeTask.estimatedBuffer || ""}
              onChange={e => setActiveTask(prev => ({ ...prev, estimatedBuffer: e.target.value }))}/>
            </label>
            <label>
              Due Date:
              <input type="date" name="dueDate"
              value={activeTask.dueDate || ""}
              onChange={e => setActiveTask(prev => ({ ...prev, dueDate: e.target.value }))}/>
            </label>
            <label>
              Difficulty:
              <select name="difficulty"
                value={activeTask.difficulty || ""}
                onChange={e => setActiveTask(prev => ({ ...prev, difficulty: e.target.value }))}>
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
          <p>{activeTask.taskName}</p>
          <p>{activeTask.reasonToSelect}</p>
        </div>
        {activeTask.efficiency ? 
          <>
            <p>Plan</p>
            <span>
              <Markdown remarkPlugins={[remarkWikiLink]}>{activeTask.efficiency}</Markdown>
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
        activeTask.createdAt != null ? 
        <div className="task-session-container">
          <Timer startTime={new Date(activeTask.localCreatedAt).getTime()} duration={activeTask.estimatedDuration} buffer={activeTask.estimatedBuffer}/> 
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
          <button onClick={handleStartTask} className="task-form-buttons" type="button" disabled={activeTask.taskName ? false : true}>Start</button>
          <button className="task-form-buttons" onClick={handleTodoSubmit} disabled={activeTask.taskName ? false : true}>Store</button>
        </div>
      }
    </form>
  }

  const handleSelectTodo = async (todo) => {
    //review
    
    setActiveTask(prev => ({
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
    
    setActiveTask(prev => ({
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
        {
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