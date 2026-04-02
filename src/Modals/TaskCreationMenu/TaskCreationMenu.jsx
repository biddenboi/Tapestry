import './TaskCreationMenu.css'
import { useContext, useEffect } from 'react'
import { AppContext } from '../../App.jsx';
import { v4 as uuid } from "uuid";
import { DAY, MINUTE, STORES } from '../../utils/Constants.js'
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import TaskSessionMenu from '../TaskSessionMenu/TaskSessionMenu.jsx';

export default NiceModal.create(() => {    
  const databaseConnection = useContext(AppContext).databaseConnection;
  const [activeTask, setActiveTask] = useContext(AppContext).activeTask;
  const modal = useModal()

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        modal.hide()
        modal.remove();
      }
    };
      
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  return modal.visible ? <div className="task-creation-menu">
    <div className="blanker"></div>
    <form action="" className="task-creation-form">   
      <div className="task-form-inputs">
      <div className="button-bar">
      </div>
      <p>Task Creation</p>
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
            Duration (min):
            <input type="number" name="estimatedDuration"
            value={activeTask.estimatedDuration || ""}
            onChange={e => setActiveTask(prev => ({ ...prev, estimatedDuration: e.target.value }))}/>
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
        <button className="task-form-buttons" onClick={handleTodoSubmit} disabled={!canSubmitTodo()}>Store</button>
      </div>
    </form>
  </ div> : ""
})