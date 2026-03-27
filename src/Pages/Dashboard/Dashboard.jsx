import './Dashboard.css'
import { useContext, useEffect, useState } from 'react'
import App, { AppContext } from '../../App.jsx';
import RankListComponent from '../../Components/Ranklist/Ranklist.jsx';
import TodoList from '../../Components/Todolist/Todolist.jsx';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import TaskSessionMenu from '../../Modals/TaskSessionMenu/TaskSessionMenu.jsx';
import NiceModal from '@ebay/nice-modal-react';
import JournalPopup from '../../Modals/JournalPopup/JournalPopup.jsx';
import { endDay, endWorkDay, startDay } from '../../utils/Helpers/Events.js';
import { EVENT } from '../../utils/Constants.js';
import EndDayConfirm from '../../Modals/EndDayConfirm/EndDayConfirm.jsx';
import { addDurationToDate, getMidnightOfDate, getLocalDate, UTCStringToLocalDate } from '../../utils/Helpers/Time';
import Purgatory from '../../Modals/Purgatory/Purgatory';

function Dashboard() {
  const databaseConnection = useContext(AppContext).databaseConnection;
  const [scheduleStage, setScheduleStage] = useState(null);

  //possibly patchy hierarchy level of syncAndUpdateEvents. Possibly Hoist into App.jsx and create buffer function
  useEffect(() => {
    const syncAndUpdateEvents = async () => {
      const p = await databaseConnection.getCurrentPlayer();

      if (p.createdAt == null) return;
      const lastEvent = await databaseConnection.getLastEventType([EVENT.wake, EVENT.end_work, EVENT.sleep]);
      const midnight = getMidnightOfDate(getLocalDate(new Date()));

      if (lastEvent === null) {
        console.log("A");
        await startDay(databaseConnection, p);
        return;
      }

      if (UTCStringToLocalDate(lastEvent.createdAt) < midnight) {
        if (lastEvent.type == EVENT.sleep) {
           console.log("B");
          await startDay(databaseConnection, p);
        }else {
           console.log("C");
          await endDay(databaseConnection, p, false);
          await startDay(databaseConnection, p);
        }
      }
      
      if (lastEvent.type === EVENT.sleep) {
        NiceModal.show(Purgatory)
      }
    }

    syncAndUpdateEvents();
  }, [useContext(AppContext).timestamp])

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
  }

  const handleAddSession = async () => {
    NiceModal.show(TaskCreationMenu)
  }

  if (scheduleStage == null) return;

  return <div className="dashboard">
    {/**activeTask.createdAt == null ? <TaskCreationMenu /> : <TaskSessionMenu />*/}
    <div>
      <button type="button" onClick={handleAddSession}>Add Session</button>
      {scheduleStage.type == EVENT.wake ? 
      <button type="button" onClick={handleEndWorkDay}>End Workday</button> : 
      <button type="button" onClick={() => NiceModal.show(EndDayConfirm)}>End Day</button>}
      
      <RankListComponent style={{width: "80vh", height:"60vh"}}/>
    </div>
    
    <TodoList style={{width: "50vh", height:"63vh"}} />
  </div>
}

export default Dashboard;