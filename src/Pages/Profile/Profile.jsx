import { useParams } from "react-router-dom";
import { AppContext } from "../../App";
import { useState, useEffect, useContext } from "react";
import './Profile.css';
import { UTCStringToLocalDate, UTCStringToLocalTime } from "../../utils/Helpers/Time";
import JournalPopup from "../../Modals/JournalPopup/JournalPopup";
import NiceModal, { useModal } from '@ebay/nice-modal-react';

function Profile() {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const timestamp = useContext(AppContext).timestamp;
//read through this code again when ur not tired
  const { index } = useParams();

  const [player, setPlayer] = useState(null);
  
  useEffect(() => {
    //calculates data about player and creates new object with calculations
    const getPlayer = async () => {
    const p = await databaseConnection.getPlayer(index);

    const history = [];

    const tasks = await databaseConnection.getRelativePlayerTasks(p);
    const journals = await databaseConnection.getRelativePlayerJournals(p);
    const events = await databaseConnection.getRelativePlayerEvents(p);
    const transactions = await databaseConnection.getRelativePlayerTransactions(p);

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
        const description = journal.title;

        const j = {
            ...journal,
            description:description,
            type: "Journal"
        }

        history.push(j);
    })

    events.forEach(event => {
        const description = event.description;

        const j = {
            ...event,
            description:description,
            type: "Event"
        }

        history.push(j);
    })

    transactions.forEach(transaction => {
        const description = transaction.name;

        const j = {
            ...transaction,
            description:description,
            type: "Transaction"
        }

        history.push(j);
    })

    history.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    //checks if player is current player to use for journal creation button
    const currentPlayer = await databaseConnection.getCurrentPlayer();
        
    setPlayer({
        ...p,
        points: sum,
        history: history,
        current: currentPlayer.UUID == index ? true : false
        });
    }

    getPlayer();
    }, [index, timestamp])



    //catch all to ensure player is set before rendering
    if (!player) return null;
    
    return <div className="profile"> 
        <div className="profile-banner">
            <div className="stats-subsection">
                <span>{UTCStringToLocalDate(player.createdAt)}</span>
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
        
        <div className="history-display">
            <div className="section-header">
                <span>Timeline</span>
                {   
                    //checks if current date, only shows button if its the same day
                    player.current ?
                    <button onClick={() => NiceModal.show(JournalPopup)}>Entry</button> 
                    : ""
                }
            </div>
            <div className="table-container">
                <table>
                        <tbody>
                            {
                                player.history.map((element, index) => (
                                <tr key={element.createdAt}>
                                    <td>{UTCStringToLocalTime(element.createdAt)}</td>
                                    <td>{element.type}</td>
                                    <td className="description">
                                        <div>
                                            <span>{element.description}</span>
                                            {element.type === "Journal" ? 
                                            <button onClick={() => NiceModal.show(JournalPopup)}>View</button> : ""}
                                        </div>
                                    </td>
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
