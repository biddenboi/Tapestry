import './Dashboard.css'
import { useContext } from 'react'
import { AppContext } from '../../App.jsx';
import RankListComponent from '../../Components/Ranklist/Ranklist.jsx';
import TodoList from '../../Components/Todolist/Todolist.jsx';
import TaskCreationMenu from '../../Components/TaskCreationMenu/TaskCreationMenu.jsx';
import TaskSessionMenu from '../../Components/TaskSessionMenu/TaskSessionMenu.jsx';

function Dashboard() {
  const [activeTask, setActiveTask] = useContext(AppContext).activeTask;

  return <div className="dashboard">
    {activeTask.createdAt == null ? <TaskCreationMenu /> : <TaskSessionMenu />}
    <RankListComponent />
    <TodoList />
  </div>
}

export default Dashboard;