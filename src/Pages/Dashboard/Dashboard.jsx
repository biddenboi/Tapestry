import './Dashboard.css'
import { useContext, useEffect, useState } from 'react'
import App, { AppContext } from '../../App.jsx';
import RankListComponent from '../../Components/Ranklist/Ranklist.jsx';
import TodoList from '../../Components/Todolist/Todolist.jsx';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import TaskSessionMenu from '../../Modals/TaskSessionMenu/TaskSessionMenu.jsx';
import NiceModal from '@ebay/nice-modal-react';
import JournalPopup from '../../Modals/JournalPopup/JournalPopup.jsx';
import { endWorkDay } from '../../utils/Helpers/Events.js';
import { EVENT } from '../../utils/Constants.js';

function Dashboard() {
  const databaseConnection = useContext(AppContext).databaseConnection;
  const [scheduleStage, setScheduleStage] = useState(null);

  useEffect(() => {
    const getScheduleStage = async () => {
      const currentStage = await databaseConnection.getLastEventType([EVENT.wake, EVENT.end_work, EVENT.sleep])
      setScheduleStage(currentStage);
    }
    getScheduleStage();
  }, [useContext(AppContext).timestamp])

  const handleEndWorkDay = async () => {
    NiceModal.show(JournalPopup, {title: "End of Workday Journal"})
    const currentPlayer = await databaseConnection.getCurrentPlayer();
    endWorkDay(databaseConnection, currentPlayer)
    setScheduleStage(EVENT.end_work)
  }

  const handleAddSession = async () => {
    NiceModal.show(TaskCreationMenu)
  }

  if (scheduleStage == null) return;

  return <div className="dashboard">
    {/**activeTask.createdAt == null ? <TaskCreationMenu /> : <TaskSessionMenu />*/}
    <div>
      <button type="button" onClick={handleAddSession}>Add Session</button>
      {scheduleStage == EVENT.wake ? 
      <button type="button" onClick={handleEndWorkDay}>End Workday</button> : 
      <button>End Day</button>}
      
      <RankListComponent style={{width: "80vh", height:"60vh"}}/>
    </div>
    
    <TodoList style={{width: "50vh", height:"63vh"}} />
  </div>
}

export default Dashboard;