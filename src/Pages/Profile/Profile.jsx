import { useParams } from "react-router-dom";
import { DatabaseConnectionContext } from "../../App";
import { useState, useEffect, useContext } from "react";

import './Profile.css';
import { getLocalDate, getTimeAsString } from "../../Helpers";

function Profile() {
//read through this code again when ur not tired
  const { index } = useParams();

  const [player, setPlayer] = useState(null);
  const [journalPopup, setJournalPopup] = useState(false);

  const databaseConnection = useContext(DatabaseConnectionContext);

  useEffect(() => {
        //REVIEW
        const handleKeyDown = (e) => {
            if (e.key === "Escape") {
                setJournalPopup(false);
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, []);
  
  useEffect(() => {
    //calculates data about player and creates new object with calculations
    const getPlayer = async () => {
    const p = await databaseConnection.getPlayer(index);

    const history = [];

    const tasks = await databaseConnection.getRelativePlayerTasks(p);
    const journals = await databaseConnection.getRelativePlayerJournals(p);

    //maybe move description to a function processed when called vs making it an attribute  

    let sum = 0;
    tasks.forEach(task => {
        if (task.duration == undefined) return;
        const description = task.taskName;

        const t = {
            ...task,
            description:description,
            type: "Task"
        }
        sum += (t.points || 0);

        history.push(t);
    });

    journals.forEach(journal => {
        const description = journal.entry;

        const j = {
            ...journal,
            description:description,
            type: "Journal"
        }

        history.push(j);
    })

    history.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        
    setPlayer({
        ...p,
        points: sum,
        history: history,
        });
    }

    getPlayer();
    }, [index])

    const handleJournalSubmit = (async (e) => {
        //prevent default needed so data does not refresh on click.
        e.preventDefault()
        const form = e.currentTarget;
        const formData = new FormData(form);

        const entryTitle = formData.get("entry-title");
        const entryText = formData.get("entry-text");

        const journal = {
            title: entryTitle,
            entry: entryText,
            //create methods for local time for tasks too in helper
            createdAt: new Date().toISOString(),
            localCreatedAt: new Date().toLocaleString('sv').replace(' ', "T"),
        }

        await databaseConnection.addJournalLog(journal);
        setJournalPopup(false);
        
        //reset
        e.target.reset();
    })

    //catch all to ensure player is set before rendering
    if (!player) return null;


    return <div className="profile"> 
        {journalPopup ? 
            <div className="journal-popup">
                <div className="blanker"></div>
                <div className="content">
                    <p>Journal Entry</p>
                    <form action="" onSubmit={handleJournalSubmit}>
                        <input type="text" name="entry-title" placeholder="Entry Title"/>
                        <textarea name="entry-text" id=""
                            placeholder="Enter your log here..."></textarea>
                        <button type="submit">Publish</button>
                    </form>
                </div>
            </div> : ""
        }
        <div className="profile-banner">
            <div className="stats-subsection">
                <span>{player.localCreatedAt.split("T")[0]}</span>
                <span>{player.username}</span>
                {player.description ? <span>{player.description}</span> : ""}
            </div>
            <div className="description-subsection">
                <div>
                    <span>Final Points: </span>
                    <span>{player.points}</span>
                </div>
                <div> 
                    <span>Entries: </span>
                    <span>{player.history.length}</span>
                </div>
            </div>
        </div>
        
        <div className="task-history-display">
            <div className="section-header">
                <span>Timeline</span>
                {
                    //checks if current date, only shows button if its the same day
                    new Date().toLocaleString('sv').split(' ')[0] + "T00:00:00" == player.localCreatedAt ?
                    <button onClick={() => setJournalPopup(true)}>Add Entry</button> 
                    : ""
                }
            </div>
            <div className="task-table-container">
                <table className="task-table">
                        <tbody>
                            {
                                player.history.map((element, index) => (
                                <tr key={element.createdAt}>
                                    <td>{getTimeAsString(element.localCreatedAt)}</td>
                                    <td>{element.type}</td>
                                    <td>{element.description}</td>
                                    {/** replace description and points with generalized method */}
                                    <td>{element.points ? element.points + "pts" : "0pts"}</td>
                                </tr>))
                            }
                        </tbody>
                </table>
            </div>
        </div>
    </div>
}

export default Profile;
