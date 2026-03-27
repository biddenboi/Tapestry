import './TaskSessionMenu.css'

import { useState, useEffect, useContext } from 'react'
import { AppContext } from '../../App.jsx';
import Timer from '../../Components/Timer/Timer.jsx';
import { msToPoints } from '../../utils/Helpers/Time.js';
import Markdown from 'react-markdown';
import remarkWikiLink from 'remark-wiki-link';
import { v4 as uuid } from "uuid";
import { DAY, MINUTE, STORES } from '../../utils/Constants.js'

import { getCurrentLocation } from '../../utils/Helpers/Location.js'
import { getTaskDuration } from '../../utils/Helpers/Tasks.js'
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import TaskCreationMenu from '../TaskCreationMenu/TaskCreationMenu.jsx';


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

    const handleTaskSubmit = async (e) => {
    e.preventDefault();

    const parent = await databaseConnection.getCurrentPlayer();

    const task = {
        ...activeTask,
        points: null,
        UUID: uuid(),
        parent: parent.UUID,
        completedAt: new Date().toISOString(),
        location: null
    }

    const duration = getTaskDuration(task);
    task.points = Math.floor(msToPoints(getTaskDuration(task)));
    
    //temporary, creates token every minute
    databaseConnection.add(STORES.player, {
        ...parent,
        tokens: Math.floor(parent.tokens + (msToPoints(duration)) / 6)
    })

    await databaseConnection.add(STORES.task, task);

    setActiveTask({});
    modal.hide();
    modal.remove();

    //note - revise maybe into seperate method?
    getCurrentLocation()
      .then(async (location) => {
        if (!location) return;

        await databaseConnection.add(STORES.task, {
            ...task,
            location,
        });
    })
    .catch((err) => {
        console.error("Background location update failed:", err);
    });
}

    const handleTaskSubmitAndSave = async (e) => {
    e.preventDefault();

    const parent = await databaseConnection.getCurrentPlayer();

    const task = {
      ...activeTask,
      points: null,
      UUID: uuid(),
      parent: parent.UUID,
      completedAt: new Date().toISOString(),
      location: null
    }

    const duration = getTaskDuration(task);
    task.points = Math.floor(msToPoints(getTaskDuration(task)));

    activeTask.estimatedDuration -= Math.floor(duration/MINUTE);

    //temporary, creates token every minute
    databaseConnection.add(STORES.player, {
      ...parent,
      tokens: Math.floor(parent.tokens + (msToPoints(duration)) / 6)
    })

    await databaseConnection.add(STORES.task, task);

    setActiveTask({...activeTask, createdAt: null});
    NiceModal.show(TaskCreationMenu)
    modal.hide();
    modal.remove();

    //note - revise maybe into seperate method?
    getCurrentLocation()
      .then(async (location) => {
        if (!location) return;

        await databaseConnection.add(STORES.task, {
            ...task,
            location,
            });
        })
        .catch((err) => {
            console.error("Background location update failed:", err);
        });
    }

    //temporary method to log free for now transactions 
    const handleLogTransaction = async (e) => {
        e.preventDefault();

        const parent = await databaseConnection.getCurrentPlayer();

        const transaction = {
        name: activeTask.taskName,
        createdAt: activeTask.createdAt,
        UUID: uuid(),
        parent: parent.UUID,
        completedAt: new Date().toISOString(),
        location: null,
        };

        await databaseConnection.add(STORES.transaction, transaction);

        setActiveTask({});
        modal.hide();
        modal.remove();

        //note - revise maybe into seperate method?
        getCurrentLocation()
        .then(async (location) => {
            if (!location) return;

            await databaseConnection.add(STORES.transaction, {
            ...transaction,
            location,
            });
        })
        .catch((err) => {
            console.error("Background location update failed:", err);
        });
    };

    return modal.visible ? <div className="task-session-menu">
      <div className="blanker"></div>
      <form action="" className="task-session-form"
        onSubmit={handleTaskSubmit}>
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
            <Timer showPoints={true} 
              startTime={new Date(activeTask.createdAt).getTime()} 
              duration={activeTask.estimatedDuration} 
              buffer={activeTask.estimatedBuffer}/> 
            <div className="task-session-buttons">
              <button type="button" onClick={handleTaskSubmitAndSave}>⎋</button>
              <button>Complete</button>

              {/**temporary button just to hold off on breaks until shop is implemented */}
              <button type="button" onClick={handleLogTransaction}>Zero Log</button>
              <button type="button" onClick={handleGiveUpTask}>End Attempt</button>        
            </div>
        </div>
      </form>
    </ div> : ""
})