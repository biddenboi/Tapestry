import './Todolist.css'
import { useState, useEffect, useContext } from "react";
import { AppContext } from '../../App.jsx';
import { DAY, MINUTE, STORES } from '../../utils/Constants.js'
import { getMostUrgent } from '../../utils/Helpers/Tasks.js'
import NiceModal from '@ebay/nice-modal-react';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';

export default function TodoList({ style }) {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const [activeTask, setActiveTask] = useContext(AppContext).activeTask;

    const [todos, setTodos] = useState([]);
    const [nextTodo, setNextTodo] = useState(null);

    useEffect(() => {
        const reload = async () => {
            const todoArray = await databaseConnection.getAll(STORES.todo);
            setTodos(todoArray);
            
            //check if nextTodo has not been used yet
            if (nextTodo != null || todoArray.length === 0) return;
            setNextTodo(getMostUrgent(todoArray));
        }
        
        reload();
    }, [databaseConnection, useContext(AppContext).timestamp, activeTask])


    const handleSelectTodo = async (todo) => {
        //review
        
        setActiveTask(prev => ({
            ...prev,
            taskName: todo.taskName,
            location: todo.location,
            distractions: todo.distractions,
            reasonToSelect: todo.reasonToSelect,
              efficiency: todo.efficiency,
            estimatedDuration: todo.estimatedDuration,
            estimatedBuffer: todo.estimatedBuffer,
            dueDate: todo.dueDate,
            difficulty: todo.difficulty,
        }));
        await databaseConnection.remove(STORES.todo, todo.UUID); 

        NiceModal.show(TaskCreationMenu)

    };

    const handleGetNextTodo = async () => {
        NiceModal.show(TaskCreationMenu)
        setActiveTask(prev => ({
            ...prev,
            taskName: nextTodo.taskName,
            location: nextTodo.location,
            distractions: nextTodo.distractions,
            reasonToSelect: nextTodo.reasonToSelect,
            efficiency: nextTodo.efficiency,
            estimatedDuration: nextTodo.estimatedDuration,
            estimatedBuffer: nextTodo.estimatedBuffer,
            dueDate: nextTodo.dueDate,
            difficulty: nextTodo.difficulty,
        }));
        await databaseConnection.remove(STORES.todo, nextTodo.UUID); 
        setNextTodo(null);
    }

    return <div className="todo-creation-menu" style={style}>
        <div>
            <p>Todo List</p>
            <button 
                onClick={() => handleGetNextTodo()} 
                disabled={!nextTodo}
                type="button">Get Next Todo
            </button>
        </div>
        <ul>
            {
            todos.map((element) => ( 
            <li
                key={element.createdAt}
                onClick={() => handleSelectTodo(element)}
                style={{ cursor: "pointer" }}>
                {element.taskName}
            </li>
            ))}
        </ul>
    </div>
}