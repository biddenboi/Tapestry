import { useState, createContext, useEffect, useMemo } from 'react';
import { Routes, Route, useNavigate, NavLink } from 'react-router-dom';
import './App.css';
import Dashboard from './Pages/Dashboard/Dashboard';
import Events from './Pages/Events/Events';
import Settings from './Pages/Settings/Settings';
import Profile from './Pages/Profile/Profile';
import Shop from './Pages/Shop/Shop';
import Inventory from './Pages/Inventory/Inventory';
import DatabaseConnection from './network/DatabaseConnection';
import { DAY, EVENT, MINUTE, SECOND } from './utils/Constants';
import { useInterval } from './utils/useInterval';
import NiceModal from '@ebay/nice-modal-react';

export const AppContext = createContext();

function App() {
    const nav = useNavigate();
    const [currentPlayer, setCurrentPlayer] = useState({});
    const [timestamp, setTimestamp] = useState(Date.now());
    const [activeTask, setActiveTask] = useState({});

    const databaseConnection = useMemo(() => new DatabaseConnection(), []);

    useEffect(() => {
        const getCurrentPlayer = async () => {
            const p = await databaseConnection.getCurrentPlayer();
            setCurrentPlayer(p);
        };
        getCurrentPlayer();
    }, [timestamp]);

    useInterval(() => setTimestamp(Date.now()), SECOND * 10);

    const contextValue = useMemo(() => ({
        databaseConnection,
        timestamp,
        activeTask: [activeTask, setActiveTask],
    }), [timestamp, activeTask]);

    const navigate = (route) => {
        if (!activeTask.createdAt) nav(route);
    };

    const inSession = !!activeTask.createdAt;

    return (
        <>
            <nav className={`nav-bar ${inSession ? 'nav-in-session' : ''}`}>
                <span className="nav-logo">TAPESTRY</span>
                <div className="nav-links">
                    <NavLink to="/"           className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={e => { e.preventDefault(); navigate('/'); }}>Dashboard</NavLink>
                    <NavLink to="/shop"       className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={e => { e.preventDefault(); navigate('/shop'); }}>Shop</NavLink>
                    <NavLink to="/inventory"  className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={e => { e.preventDefault(); navigate('/inventory'); }}>Inventory</NavLink>
                    <NavLink to={`/profile/${currentPlayer?.UUID}`} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={e => { e.preventDefault(); navigate(`/profile/${currentPlayer?.UUID}`); }}>Profile</NavLink>
                    <NavLink to="/settings"   className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} onClick={e => { e.preventDefault(); navigate('/settings'); }}>Settings</NavLink>
                </div>
                {inSession && <span className="nav-session-badge">IN SESSION</span>}
            </nav>

            <AppContext.Provider value={contextValue}>
                <NiceModal.Provider>
                    <Routes>
                        <Route path="/"                element={<Dashboard />} />
                        <Route path="/events"          element={<Events />} />
                        <Route path="/shop"            element={<Shop />} />
                        <Route path="/inventory"       element={<Inventory />} />
                        <Route path="/settings"        element={<Settings />} />
                        <Route path="/profile/:index"  element={<Profile />} />
                    </Routes>
                </NiceModal.Provider>
            </AppContext.Provider>
        </>
    );
}

export default App;
