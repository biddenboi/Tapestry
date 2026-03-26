//import './TaskCreationMenu.css'
import { useContext } from 'react'
import { AppContext } from '../../App.jsx';

export default function TaskCreationMenu() {    
    const [activeTask, setActiveTask] = useContext(AppContext).activeTask;

    const handleEndWorkDay = async () => {
        const currentPlayer = await databaseConnection.getCurrentPlayer();
        endWorkDay(databaseConnection, currentPlayer)
    }

    const handleStartTask = () => {
        const taskData = {
            ...activeTask,
            createdAt: new Date().toISOString(),
        }
        setActiveTask(taskData);
    }

    const handleTodoSubmit = async (e) => {
        e.preventDefault();

        const todo = {
            ...activeTask,
            createdAt: new Date().toISOString(),
            parent: parent.UUID,
            UUID: uuid(),
        }

        await databaseConnection.add(STORES.todo, todo);

        setActiveTask({});
    }

    return <>
      <form action="" className="task-creation-menu">   
        <div className="task-form-inputs">
        <div className="button-bar">
          <button
            type="button" onClick={handleEndWorkDay}
            >End Workday</button>
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
        <div className="task-planning-buttons">
          <button onClick={handleStartTask} className="task-form-buttons" type="button" disabled={activeTask.taskName ? false : true}>Start</button>
          <button className="task-form-buttons" onClick={handleTodoSubmit} disabled={activeTask.taskName ? false : true}>Store</button>
        </div>
      </form>
    </>
}