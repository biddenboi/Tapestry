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
        setActiveTask({...todo, originalDuration: todo.estimatedDuration}); 
        await databaseConnection.remove(STORES.todo, todo.UUID);
        NiceModal.show(TaskCreationMenu)
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

    /**
     * Say we have a task of Q time due in D days. 
     * Say we want to make an algorithm that gives you the amount of work per day, denoted by Q/D.  
     * Since Q is proportional to D, if every day completes the necessary equal area % of work to finish, Q/D should always be constant and also the amount of work done each day. 
     * Therefore, a number greater than Q/D means that we are not doing enough to fufill a day, and a number less than Q/D means we are doing more than required for a day. 
     * To track how much work we have to do in a day, we can use a variable M which keeps track of the total time someone has worked. 
     * Therefore, when M > Q/D we have done more than enough work for that day. 
     * However, we don't store the actual total Q nor the total amount of days. 
     * They are always relative.
     * Meaning that if we did no work and its one day closer, we only have the information of it being one day closer and the duration. 
     * What Im not sure, is if M > Q/D still holds in this instance, since any work completed reduces Q/D but also increases M, leading to the possibility of double counting workload and undervaluing the true amount of work left. 
     * The second issue, is if the duration of the task is changed. Say we change the Q of a half completed task to add 1/2Q to the time. 
     * Now M is no longer relative to the % of area needed to be completed each day, since it eats partially into completed time thats not considered within the calculated Q/D. 
     * The fix for that was adding/subtracting from M the value of Q delta / D, such that the new difference in area is spread over the days needed to work, but im likewise worried this double counts as well.
     */
    const [minLeftToWork, setMinLeftToWork] = useState(null);
    const [minWorked, setMinWorked] = useState(null);

    useEffect(() => {
        const handleKeyDown = (e) => {
          if (e.key === "ArrowUp") {
            handleGetNextTodo()
          }
        };
          
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
      }, [nextTodo]);

    useEffect(() => {
        const reload = async () => {
            const todoArray = await databaseConnection.getAll(STORES.todo);
            const currentPlayer = await databaseConnection.getCurrentPlayer();
            const weightArray = getWeights(todoArray);

            const AllTodoWPD = await getAllWPDFromArray(todoArray);
            const SumTodoWPD = AllTodoWPD.reduce((a, c) => a+c, 0);

            setMinLeftToWork(SumTodoWPD);
            setMinWorked(currentPlayer.minutesClearedToday);

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
        if (!nextTodo) return;

        setActiveTask(nextTodo);
        await databaseConnection.remove(STORES.todo, nextTodo.UUID);
        setNextTodo(null);
        NiceModal.show(TaskPreviewMenu, { start: true });
    };

    return <div className="todo-creation-menu" style={style}>
        <div className="header">
            <p>Todo List</p>
            {minLeftToWork > 0 && <p>{formatDuration(minLeftToWork*MINUTE)} Left</p>}
            <p>{formatDuration(minWorked*MINUTE) || 0} Worked</p>
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