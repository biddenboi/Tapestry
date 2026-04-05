import './TaskPreviewMenu.css'
import { useContext, useEffect } from 'react'
import { AppContext } from '../../App.jsx';
import { v4 as uuid } from "uuid";
import { DAY, MINUTE, STORES } from '../../utils/Constants.js'
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import TaskSessionMenu from '../TaskSessionMenu/TaskSessionMenu.jsx';
import { getTodoWPD, getDaysUntilDue } from '../../utils/Helpers/Tasks.js';

export default NiceModal.create(() => {    
  const databaseConnection = useContext(AppContext).databaseConnection;
  const [activeTask, setActiveTask] = useContext(AppContext).activeTask;
  const modal = useModal()

  useEffect(() => {
    //limit session to 60 minutes to emphasize quick scrolling through tasks
    activeTask.sessionDuration = Math.min(Math.floor(getTodoWPD(activeTask)), 60);
  }, [])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "ArrowLeft" && canSubmitTodo()) {
        handleTodoSubmit()
      }
      if (e.key === "ArrowRight") {
        startSession()
      }
    };
      
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeTask]);

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
            Session Duration ({activeTask.sessionDuration || ""} minutes):
            <input type="range" name="sessionDuration" min="1" max="60"
            value={activeTask.sessionDuration || ""}
            onChange={e => setActiveTask(prev => ({ ...prev, sessionDuration: e.target.value }))}/>
          </label>  
          <label>
            How will you use the time?
            <textarea name="efficiency"
            value={activeTask.efficiency || ""}
            onChange={e => setActiveTask(prev => ({ ...prev, efficiency: e.target.value }))}/>
          </label>
        </div>
      </div>
    </form>
  </ div> : ""
})