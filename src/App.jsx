import { useState, createContext, useEffect, useMemo } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import './App.css';
import Dashboard from "./Pages/Dashboard/Dashboard";
import Events from "./Pages/Events/Events";
import Settings from "./Pages/Settings/Settings";
import Profile from "./Pages/Profile/Profile";
import Shop from "./Pages/Shop/Shop";
import DatabaseConnection from "./network/DatabaseConnection";
import { MINUTE, SECOND } from './utils/Constants';
import { useInterval } from './utils/useInterval';



export const AppContext = createContext();

/*Start Point of React Program. Handles page navigation and database connection.*/
function App() {
  /*Internal Data*/
  const nav = useNavigate(); 

  const [isTaskSession, setIsTaskSession] = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState({});

  //global updater useInterval
  const [timestamp, setTimestamp] = useState(Date.now());
  
  const databaseConnection = useMemo(() => new DatabaseConnection(), []);

  const contextValue = useMemo(() => ({
    databaseConnection: databaseConnection,
    timestamp: timestamp
  }), [databaseConnection, timestamp])

  // calls createPlayer on app load, if player does not exist then it creates a new profile.
  useEffect(() => {
    //UPDATE TO BE ONCE PER DAY THROUGH CREATED AT COMPARISON CHECKS
    const getCurrentProfile = async () => {
      const p = await databaseConnection.getCurrentPlayer();
      setCurrentPlayer(p);
    }

    getCurrentProfile();
  }, [timestamp])

  useInterval(() => {
    setTimestamp(Date.now())
    //NOTE: CHANGE SECONDS TO MINUTES AFTER TESTING
  }, 5* SECOND)


  //navigating across routes
  const navigate = (route) => {
    if (!isTaskSession) {
      nav(route);
    }
  }
  
  return <>
    <div className={isTaskSession ? "navigation-bar task-in-session" : "navigation-bar"}>
      <a onClick={() => navigate("/")}>Dashboard</a>
      <a onClick={() => navigate("/events")}>Events</a>
      <a onClick={() => navigate("/shop")}>Shop</a>
      <a onClick={() => navigate(`/profile/${currentPlayer.UUID}`)}>Profile</a>
      <a onClick={() => navigate("/settings")}>Settings</a>
    </div>

    {/*Provides database connection to all child components.*/}
    <AppContext.Provider value={contextValue}>
        <Routes>
          <Route 
            path='/' 
            element={<Dashboard isTaskSession={isTaskSession} setIsTaskSession={setIsTaskSession}
            ></Dashboard>}/>
          <Route path='/events' element={<Events></Events>}/>
          <Route path='/shop' element={<Shop></Shop>}/>
          <Route path='/settings' element={<Settings></Settings>}/>
          <Route path='/profile/:index' element={<Profile></Profile>}/>
        </Routes>
    </AppContext.Provider>
  </>
}
export default App;