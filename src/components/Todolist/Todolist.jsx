import './Todolist.css'
import { useState, useEffect, useContext } from "react";
import { AppContext } from '../../App.jsx';
import { DAY, MINUTE, STORES } from '../../utils/Constants.js'
import { getWeights, getNextTodo } from '../../utils/Helpers/Tasks.js'
import NiceModal from '@ebay/nice-modal-react';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import { prettyPrintDate } from '../../utils/Helpers/Time.js';

function TodoItem({element}) {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const [activeTask, setActiveTask] = useContext(AppContext).activeTask;

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

        NiceModal.show(TaskCreationMenu, { start: false})
    };

    return <div className="todo-item" onClick={() => handleSelectTodo(element)}>
        <div>
            <span style={{color: `hsl(145, ${element.weight}%, 42%`}}>{element.taskName}</span>
            <p>{element.difficulty} · {element.weight}%</p>
        </div>
        <span>{prettyPrintDate(element.dueDate)}</span>
    </div>
}

export default function TodoList({ style }) {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const [activeTask, setActiveTask] = useContext(AppContext).activeTask;

    const [todos, setTodos] = useState([]);
    const [nextTodo, setNextTodo] = useState(null);

    useEffect(() => {
        const reload = async () => {
            const todoArray = await databaseConnection.getAll(STORES.todo);
            const weightArray = getWeights(todoArray)

            setTodos(todoArray.map((element, i) => ({
                ...element,
                weight: Math.floor(weightArray[i])
            })))
            
            //check if nextTodo has not been used yet
            if (nextTodo != null || todoArray.length === 0) return;
            setNextTodo(getNextTodo(todoArray, weightArray));
        }
        reload();
    }, [databaseConnection, activeTask])

    const handleGetNextTodo = async () => {
        NiceModal.show(TaskCreationMenu, { start: true})
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
        <div className="header">
            <p>Todo List</p>
            <button 
                onClick={() => handleGetNextTodo()} 
                disabled={!nextTodo}
                type="button">Get Next Todo
            </button>
        </div>
        <div className="content">
            {
            todos.map((element) => ( 
                <TodoItem
                    key={element.UUID}
                    element={element}>
                </TodoItem>
            ))}
        </div>
    </div>


}