import './TaskPreviewMenu.css'
import { useContext, useEffect } from 'react'
import { AppContext } from '../../App.jsx';
import { v4 as uuid } from "uuid";
import { DAY, MINUTE, STORES } from '../../utils/Constants.js'
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import TaskSessionMenu from '../TaskSessionMenu/TaskSessionMenu.jsx';
import { getTodoWPD } from '../../utils/Helpers/Tasks.js';

export default NiceModal.create(() => {    
  const databaseConnection = useContext(AppContext).databaseConnection;
  const [activeTask, setActiveTask] = useContext(AppContext).activeTask;
  const modal = useModal()

  useEffect(() => {
    activeTask.sessionDuration = Math.floor(getTodoWPD(activeTask));
  }, [])

  const startSession = async () => {
    const parent = await databaseConnection.getCurrentPlayer();
    const task = {
        ...activeTask,
        createdAt: new Date().toISOString(),
        parent: parent.UUID,
        UUID: uuid(),
    }
    setActiveTask(task);

    modal.hide();
    modal.remove();
    NiceModal.show(TaskSessionMenu)
  }

  const handleTodoSubmit = async (e) => {
    e.preventDefault();

    await databaseConnection.add(STORES.todo, {...activeTask, UUID: uuid()});

    setActiveTask({});
    modal.hide();
    modal.remove();
  }

  const canSubmitTodo = () => {
    if (!activeTask.dueDate) return false;
    if (!activeTask.estimatedDuration) return false;
    return true; 
  }

  return modal.visible ? <div className="task-preview-menu">
    <div className="blanker"></div>
    <form action="" className="task-preview-form">   
      <div className="task-form-inputs">
      <div className="button-bar">
      </div>
      <p>Preview</p>
        <div className="inputs">
          <label>
            Task Name:
            <input type="text" name="name" 
            value={activeTask.name || ""}
            onChange={e => setActiveTask(prev => ({ ...prev, name: e.target.value }))}/>
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
            Session (min):
            <input type="number" name="sessionDuration" min="1"
            value={activeTask.sessionDuration | ""}
            onChange={e => setActiveTask(prev => ({ ...prev, sessionDuration: e.target.value }))}/>
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
              onChange={e => setActiveTask(prev => ({ ...prev, difficulty: e.target.value }))}
              value={activeTask.difficulty || ""}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
        </div>
      </div>
      <div className="task-planning-buttons">
        <button onClick={startSession} className="task-form-buttons" type="button">Start</button> 
        <button className="task-form-buttons" onClick={handleTodoSubmit} disabled={!canSubmitTodo()}>Store</button>
      </div>
    </form>
  </ div> : ""
})