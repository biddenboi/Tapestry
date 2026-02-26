import { useState, createContext, useEffect, useMemo } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';

import './App.css';
import Dashboard from "./Pages/Dashboard/Dashboard";
import Events from "./Pages/Events/Events";
import Settings from "./Pages/Settings/Settings";
import Journal from "./Pages/Journal/Journal";
import Profile from "./Pages/Profile/Profile";
import Shop from "./Pages/Shop/Shop";
import DatabaseConnection from "./network/DatabaseConnection";
import PlayerDatabase from "./network/Database/PlayerDatabase";

export const DatabaseConnectionContext = createContext();

/*Start Point of React Program. Handles page navigation and database connection.*/
function App() {
  /*Internal Data*/
  const nav = useNavigate(); 

  const [isTaskSession, setIsTaskSession] = useState(false);
  
  const databaseConnection = useMemo(() => new DatabaseConnection(), 
    []
  );

  //dependent on databaseConnection so it recalls once databaseConnection is established.
  const playerDatabase = useMemo(() => new PlayerDatabase(databaseConnection),
    [databaseConnection]
  );

  // calls createPlayer on app load, if player does not exist then it creates a new profile.
  useEffect(() => {
    const tryNewProfile = async () => {
      const player = {
        username: "Guest",
        createdAt: new Date().toISOString().split('T')[0]
      }
      await playerDatabase.createPlayer(player);
    }

    tryNewProfile();
  }, [playerDatabase])

  //navigating across routes
  const navigate = (route) => {
    if (!inTaskSession) {
      nav(route);
    }
  }
  
  return <>
    <div className={isTaskSession ? "navigation-bar task-in-session" : "navigation-bar"}>
      <a onClick={() => navigate("/")}>Dashboard</a>
      <a onClick={() => navigate("/events")}>Events</a>
      <a onClick={() => navigate("/shop")}>Shop</a>
      <a onClick={() => navigate("/journal")}>Journal</a>
      <a onClick={() => navigate("/settings")}>Settings</a>
    </div>

    {{/*Provides database connection to all child components.*/}}
    <DatabaseConnectionContext.Provider value={databaseConnection}>
        <Routes>
          <Route 
            path='/' 
            element={<Dashboard isTaskSession={isTaskSession} setIsTaskSession={setIsTaskSession}
            index></Dashboard>}/>
          <Route path='/events' element={<Events></Events>}/>
          <Route path='/shop' element={<Shop></Shop>}/>
          <Route path='/journal' element={<Journal></Journal>}/>
          <Route path='/settings' element={<Settings></Settings>}/>
          <Route path='/profile' element={<Profile></Profile>}/>
        </Routes>
    </DatabaseConnectionContext.Provider>
  </>
}
export default App;