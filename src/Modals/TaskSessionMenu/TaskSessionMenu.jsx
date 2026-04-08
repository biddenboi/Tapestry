import './TaskSessionMenu.css'

import { useState, useEffect, useContext, act } from 'react'
import { AppContext } from '../../App.jsx';
import Timer from '../../Components/Timer/Timer.jsx';
import { formatDateAsLocalString, getLocalDate, msToPoints } from '../../utils/Helpers/Time.js';
import Markdown from 'react-markdown';
import remarkWikiLink from 'remark-wiki-link';
import { v4 as uuid } from "uuid";
import { DAY, MINUTE, STORES } from '../../utils/Constants.js'

import { getCurrentLocation } from '../../utils/Helpers/Location.js'
import { getSessionMultiplier, getTaskDuration } from '../../utils/Helpers/Tasks.js'
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import TaskCreationMenu from '../TaskCreationMenu/TaskCreationMenu.jsx';
import SessionResults from '../SessionResults/SessionResults.jsx';


export default NiceModal.create(() => {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const [activeTask, setActiveTask] = useContext(AppContext).activeTask;
    const modal = useModal()

    useEffect(() => {
        const handleKeyDown = (e) => {
        if (e.key === "ArrowLeft") {
            handleGiveUpTask()
        }
        if (e.key === "ArrowRight") {
            handleTaskSubmit()
        }
        };
        
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [activeTask]);

    const handleGiveUpTask = async (e) => {
        setActiveTask({...activeTask, createdAt: null});
        NiceModal.show(TaskCreationMenu)
        modal.hide();
        modal.remove();
    }

    const handleTaskSubmit = async () => {
        const estimatedDuration = parseFloat(activeTask.estimatedDuration) || 0;
        const sessionDuration = parseFloat(activeTask.sessionDuration) || 0;
        const parent = await databaseConnection.getCurrentPlayer();
        
        const task = {
            ...activeTask,
            points: null,
            completedAt: new Date().toISOString(),
            location: null
        }

        //calculating point gain logic
        const duration = getTaskDuration(task); //in ms
        const multiplier = getSessionMultiplier(duration, task.sessionDuration * MINUTE); //in ms
        task.points = Math.floor(msToPoints(duration) * multiplier);
        
        const tokensGained = Math.floor(msToPoints(duration) / 6);

        databaseConnection.add(STORES.player, {
            ...parent,
            tokens: Math.floor(parent.tokens + tokensGained),
            minutesClearedToday: parent.minutesClearedToday + parseFloat(sessionDuration || 0),
        });

        await databaseConnection.add(STORES.task, task);

        modal.hide();
        modal.remove();

        //showing results
        NiceModal.show(SessionResults, {
            duration,
            tokens: tokensGained,
            sessionDuration: sessionDuration,
            showTaskCreation: true,
        });

        activeTask.estimatedDuration = estimatedDuration - sessionDuration;

        //after complete, convert date back to proper format for submit.
        setActiveTask({...{
            ...activeTask,
            dueDate: formatDateAsLocalString(new Date(activeTask.dueDate)).slice(0, 16),
        }, createdAt: null});
        
        //async for setting location without causing popup open delay - possibly unnecessary
        getCurrentLocation()
            .then(async (location) => {
                if (!location) return;
                await databaseConnection.add(STORES.task, { ...task, location });
            })
            .catch((err) => {
                console.error("Background location update failed:", err);
            });
    }

    return modal.visible ? <div className="task-session-menu">
        <div className="blanker"></div>
        {/**maybe not make it a form, is it necessary? it only really exists as indicator.*/}
        <form action="" className="task-session-form" onSubmit={handleTaskSubmit}>
            <div className="task-session-description">
                <div className="task-titlebar">
                    <p>{activeTask.name}</p>
                    <p>{activeTask.reasonToSelect}</p>
                </div>
                <p>Plan</p>
                <span>
                    <Markdown remarkPlugins={[remarkWikiLink]}>{activeTask.efficiency}</Markdown>
                </span>
            </div>
        </form>
    </div> : ""
})