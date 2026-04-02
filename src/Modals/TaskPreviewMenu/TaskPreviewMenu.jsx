import './TaskPreviewMenu.css'
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
        putTodoBack();
        modal.hide()
        modal.remove();
      }
    };
      
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const startSession = () => {
    //What is parent?
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

  const putTodoBack = async (e) => {
    await databaseConnection.add(STORES.todo, {...activeTask, UUID: uuid()});

    setActiveTask({});
    modal.hide();
    modal.remove();
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
            disabled={true}/>
          </label>
          <label>
            Why did you pick this task?
            <textarea name="reasonToSelect"
            value={activeTask.reasonToSelect || ""}
            disabled={true}/>
          </label>
          <label>
            How will you use the time?
            <textarea name="efficiency"
            value={activeTask.efficiency || ""}
            disabled={true}/>
          </label>
          <label>
            Session (min):
            <input type="number" name="sessionDuration"
            value={activeTask.sessionDuration || ""}
            onChange={e => setActiveTask(prev => ({ ...prev, sessionDuration: e.target.value }))}/>
          </label> 
          <label>
            Difficulty:
            <select name="difficulty"
              value={activeTask.difficulty || ""}
              disabled={true}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
        </div>
      </div>
      <div className="task-planning-buttons">
      <button onClick={startSession} className="task-form-buttons" type="button" disabled={activeTask.sessionDuration ? false : true}>Start</button> 
      </div>
    </form>
  </ div> : ""
})