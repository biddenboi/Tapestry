import { useParams } from "react-router-dom";
import { AppContext } from "../../App";
import { useState, useEffect, useContext } from "react";
import './Profile.css';
import { STORES } from '../../utils/Constants.js'
import { UTCStringToLocalDate, UTCStringToLocalTime, formatDuration } from "../../utils/Helpers/Time";
import JournalPopup from "../../Modals/JournalPopup/JournalPopup";
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { getTaskDuration } from  '../../utils/Helpers/Tasks.js'
import { getRankColorClass } from "../../utils/Helpers/Players.js";

function HistoryItem({ element }) {
    const type = element.type;
    const iconMap = { task: "TSK", journal: "JNL", event: "EVT", transaction: "TXN" };

    const title = element.taskName ?? element.title ?? element.description ?? element.name ?? "—";
    const time = UTCStringToLocalTime(element.createdAt);

    let subtitle = type;
    if (type === "task") {
        const dur = formatDuration(element.duration);
        if (dur) subtitle += ` · ${dur}`;
    } else if (type === "journal" && element.entry) {
        subtitle += ` · ${element.entry.slice(0, 40)}${element.entry.length > 40 ? "…" : ""}`;
    } else if (type === "event" && element.type) {
        subtitle += ` · ${element.type}`;
    } else if (type === "transaction" && element.location) {
        subtitle += ` · ${element.location}`;
    }

    const pts = type === "task" && element.points > 0 ? `+${element.points} pts`
        : type === "transaction" && element.cost ? `−${element.cost} tokens`
        : null;

    return (
        <div className="history-item">
            <div className="history-item-left">
                <div className={`history-item-icon history-item-icon--${type}`}>
                    {iconMap[type]}
                </div>
                <div className="history-item-body">
                    <span className="history-item-name">{title}</span>
                    <span className="history-item-sub">{subtitle}</span>
                </div>
            </div>
            <div className="history-item-right">
                {pts && <span className="history-item-pts">{pts}</span>}
                <span className="history-item-time">{time}</span>
            </div>
        </div>
    );
}

function Profile() {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const timestamp = useContext(AppContext).timestamp;
//read through this code again when ur not tired
  const { index } = useParams();

  const [player, setPlayer] = useState(null);
  
  useEffect(() => {
    //calculates data about player and creates new object with calculations
    const getPlayer = async () => {
        const p = await databaseConnection.get(STORES.player, index);
        const history = [];

        // Tasks use the relative window — same elapsed time comparison across players
        const tasks        = await databaseConnection.getRelativePlayerStore(STORES.task, p);
        
        // Everything else uses full player history — not windowed
        const journals     = await databaseConnection.getPlayerStore(STORES.journal, p.UUID);
        const events       = await databaseConnection.getPlayerStore(STORES.event, p.UUID);
        //repair by adding on creation - const transactions = await databaseConnection.getPlayerStore(STORES.transaction, p.UUID)

        let sum = 0;
        tasks.forEach(task => {
            //necessary if condition?
            if (getTaskDuration(task) == undefined) return;
            history.push({
                ...task,
                type: "task"
            });
            sum += (task.points || 0);
        })

        journals.forEach(journal => {
            //necessary if condition?
            history.push({
                ...journal,
                type: "journal"
            });
        })

        events.forEach(event => {
            history.push({
                ...event,
                type: "event"
            });
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
                <span className={getRankColorClass(player)}>{player.username}</span>
                {player.description ? <span>{player.description}</span> : ""}
            </div>
            <div className="description-subsection">
                <div>
                    <span>Elo: </span>
                    <span>{player.elo}</span>
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
            <div className="container">
                {player.history.map((element, index) => (
                    <HistoryItem
                        element={element}
                        key={element.UUID}
                    ></HistoryItem>
                ))}
            </div>
        </div>
    </div>
}

export default Profile;
