import './TaskSessionMenu.css'

import { useState, useEffect, useContext, act } from 'react'
import { AppContext } from '../../App.jsx';
import Timer from '../../Components/Timer/Timer.jsx';
import { msToPoints } from '../../utils/Helpers/Time.js';
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

    const handleGiveUpTask = async (e) => {
        e.target.form.reset();
        setActiveTask({...activeTask, createdAt: null});
        NiceModal.show(TaskCreationMenu)
        modal.hide();
        modal.remove();
    }

    const handleTaskSubmit = async (save=false) => {
        const parent = await databaseConnection.getCurrentPlayer();

        const task = {
            ...activeTask,
            points: null,
            completedAt: new Date().toISOString(),
            location: null
        }

        //calculating point gain logic
        const duration = getTaskDuration(task);
        const multiplier = getSessionMultiplier(duration, task.estimatedDuration * MINUTE);
        task.points = Math.floor(msToPoints(duration) * multiplier);

        const tokensGained = Math.floor(msToPoints(duration) / 6);
        databaseConnection.add(STORES.player, {
            ...parent,
            tokens: Math.floor(parent.tokens + tokensGained)
        });

        await databaseConnection.add(STORES.task, task);

        modal.hide();
        modal.remove();

        //showing results
        NiceModal.show(SessionResults, {
            duration,
            tokens: tokensGained,
            sessionDuration: task.sessionDuration,
            showTaskCreation: save,
        });

        if (save) {
            activeTask.estimatedDuration -= activeTask.sessionDuration;
            setActiveTask({...activeTask, createdAt: null});
        }else {
            setActiveTask({});
        }
        
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
                    <p>{activeTask.taskName}</p>
                    <p>{activeTask.reasonToSelect}</p>
                </div>
                {activeTask.efficiency ?
                    <>
                        <p>Plan</p>
                        <span>
                            <Markdown remarkPlugins={[remarkWikiLink]}>{activeTask.efficiency}</Markdown>
                        </span>
                    </>
                    : ""
                }
            </div>
            <div className="task-session-container">
                {/**<Timer showPoints={true} 
                    startTime={new Date(activeTask.createdAt).getTime()} 
                    duration={activeTask.estimatedDuration} />*/}
                <div className="task-session-buttons">
                    <button type="button" onClick={() => handleTaskSubmit(true)}>⎋</button>
                    <button type="button" onClick={() => handleTaskSubmit(false)}>Complete</button>
                    {/**temporary button just to hold off on breaks until shop is implemented */}
                    <button type="button" onClick={handleGiveUpTask}>End Attempt</button>
                </div>
            </div>
        </form>
    </div> : ""
})