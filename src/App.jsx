import { useState, createContext, useEffect, useMemo } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import './App.css';
import Dashboard from "./Pages/Dashboard/Dashboard";
import Events from "./Pages/Events/Events";
import Settings from "./Pages/Settings/Settings";
import Profile from "./Pages/Profile/Profile";
import Shop from "./Pages/Shop/Shop";
import DatabaseConnection from "./network/DatabaseConnection";
import { DAY, EVENT, MINUTE, SECOND } from './utils/Constants';
import { useInterval } from './utils/useInterval';

import NiceModal from '@ebay/nice-modal-react';


export const AppContext = createContext();

/*Start Point of React Program. Handles page navigation and database connection.*/
function App() {
  /*Internal Data*/
  const nav = useNavigate(); 

  const [currentPlayer, setCurrentPlayer] = useState({});

  //global updater useInterval
  const [timestamp, setTimestamp] = useState(Date.now());
  const [activeTask, setActiveTask] = useState({});

  useEffect(() => {
    const getCurrentPlayer = async () => {
      const p = await databaseConnection.getCurrentPlayer();

      setCurrentPlayer(p);
    }
    getCurrentPlayer();
  })
  
  const databaseConnection = useMemo(() => new DatabaseConnection(), []);

  const contextValue = useMemo(() => ({
    //context value sends update prompt when data within changes, only changes on timestamp or active
    databaseConnection: databaseConnection,
    timestamp: timestamp,
    activeTask: [activeTask, setActiveTask]
  }), [timestamp, activeTask])

  //navigating across routes
  const navigate = (route) => {
    if (!activeTask.createdAt) {
      nav(route);
    }
  }
  
  return <>
    <div className={activeTask.createdAt ? "navigation-bar task-in-session" : "navigation-bar"}>
      <a onClick={() => navigate("/")}>Dashboard</a>
      {/**<a onClick={() => navigate("/events")}>Events</a>*/}
      {/**<a onClick={() => navigate("/shop")}>Shop</a>*/}
      <a onClick={() => navigate(`/profile/${currentPlayer.UUID}`)}>Profile</a>
      <a onClick={() => navigate("/settings")}>Settings</a>
    </div>

    {/*Provides database connection to all child components.*/}
    <AppContext.Provider value={contextValue}>
      <NiceModal.Provider>
        <Routes>
          <Route 
            path='/' 
            element={<Dashboard
            ></Dashboard>}/>
          <Route path='/events' element={<Events></Events>}/>
          <Route path='/shop' element={<Shop></Shop>}/>
          <Route path='/settings' element={<Settings></Settings>}/>
          <Route path='/profile/:index' element={<Profile></Profile>}/>
        </Routes>
      </NiceModal.Provider>
    </AppContext.Provider>
  </>
}
export default App;