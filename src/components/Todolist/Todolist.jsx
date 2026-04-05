import './Todolist.css'
import { useState, useEffect, useContext, act } from "react";
import { AppContext } from '../../App.jsx';
import { DAY, MINUTE, STORES } from '../../utils/Constants.js'
import { getWeights, getNextTodo, getTodoWPD, getAllWPDFromArray } from '../../utils/Helpers/Tasks.js'
import NiceModal from '@ebay/nice-modal-react';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import { prettyPrintDate, formatDuration } from '../../utils/Helpers/Time.js';
import TaskPreviewMenu from '../../Modals/TaskPreviewMenu/TaskPreviewMenu.jsx';
import { useInterval } from '../../utils/useInterval.js';

function TodoItem({element}) {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const [activeTask, setActiveTask] = useContext(AppContext).activeTask;
    

    const handleSelectTodo = async (todo) => {
        //review
        
        setActiveTask(prev => ({
            ...prev,
            name: todo.name,
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
            <span style={{color: `hsl(145, ${element.weight}%, 42%`}}>{element.name}</span>
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
    const [minLeftToWork, setMinLeftToWork] = useState(null);

    useEffect(() => {
        const reload = async () => {
            const todoArray = await databaseConnection.getAll(STORES.todo);
            const AllTodoWPD = await getAllWPDFromArray(todoArray);
            const weightArray = getWeights(todoArray);

            setMinLeftToWork(AllTodoWPD.reduce((a, c) => a+c, 0));

            setTodos(todoArray.map((element, i) => ({
                ...element,
                weight: Math.floor(weightArray[i])
            })))
            
            //check if nextTodo has not been used yet
            setNextTodo(getNextTodo(todoArray, weightArray));
        }
        reload();
    }, [databaseConnection, activeTask])

    const handleGetNextTodo = async () => {
        NiceModal.show(TaskPreviewMenu, { start: true})
        setActiveTask(prev => ({
            ...prev,
            name: nextTodo.name,
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
            <p>{formatDuration(minLeftToWork*MINUTE)} Left</p>
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