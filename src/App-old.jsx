import Dashboard from "./Pages/Dashboard/Dashboard";
import Events from "./Pages/Events/Events";
import Settings from "./Pages/Settings/Settings";
import Journal from "./Pages/Journal/Journal";
import Profile from "./Pages/Profile/Profile";
import Shop from "./Pages/Shop/Shop";

import './App.css';
import { useState, createContext, useEffect, useMemo } from 'react';
import DatabaseConnection from "./network/DatabaseConnection";
import PlayerDatabase from "./network/Database/PlayerDatabase";
import { Routes, Route, useNavigate } from 'react-router-dom';

export const DatabaseConnectionContext = createContext();

function App() {
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
        createdAt: new Date().toISOString(),
        localCreatedAt: new Date().toLocaleString('sv').split(' ')[0]
      }
      await playerDatabase.createPlayer(player);
    }

    tryNewProfile();
  }, [playerDatabase])

  //navigating across routes
  const navigate = (route) => {
    if (!isTaskSession) {
      nav(route);
    }
  }

  
  return <>
    <div className={inTaskSession ? "navigation-bar task-in-session" : "navigation-bar"}>
      <a onClick={() => navigate("/")}>Dashboard</a>
      <a onClick={() => navigate("/events")}>Events</a>
      <a onClick={() => navigate("/shop")}>Shop</a>
      <a onClick={() => navigate("/journal")}>Journal</a>
      <a onClick={() => navigate("/settings")}>Settings</a>
    </div>
    <DatabaseConnectionContext.Provider value={databaseConnection}>
        <Routes>
          <Route path='/' element={<Dashboard inTaskSession={inTaskSession} setInTaskSession={setInTaskSession}></Dashboard>}/>
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