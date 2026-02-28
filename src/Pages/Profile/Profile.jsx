import { useNavigate, useParams } from "react-router-dom";
import { DatabaseConnectionContext } from "../../App";
import { useState, useEffect, useContext } from "react";

import './Profile.css';
import { getTimeAsString } from "../../Helpers";

function Profile() {
//read through this code again when ur not tired
  const { index } = useParams();

  const [player, setPlayer] = useState(null);

  const databaseConnection = useContext(DatabaseConnectionContext);
  
  useEffect(() => {
    //calculates data about player and creates new object with calculations
    const getPlayer = async () => {
      const p = await databaseConnection.getPlayer(index);

      const history = [];

      const tasks = await databaseConnection.getRelativePlayerTasks(p);

      let sum = 0;
        tasks.forEach(task => {
            const t = {
                ...task,
                type: "Task Completion"
            }

            sum += (t.points || 0);

            history.push(t);
        });

      setPlayer({
          ...p,
          points: sum,
          history: history,
        });
    }

    getPlayer();
  }, [index])

  //catch all to ensure player is set before rendering
  if (!player) return null;

    return <div className="profile">
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
                    <span>Completions: </span>
                    <span>{player.history.length}</span>
                </div>
            </div>
        </div>
        <div className="seperator">
            <span>Timeline</span>
            <button>+ Add Entry</button>
        </div>
        <div className="task-history-display">
            <div className="task-table-container">
                <table className="task-table">
                        <tbody>
                            {
                                player.history.map((element, index) => (
                                <tr key={element.createdAt}>
                                    <td>{getTimeAsString(element.createdAt)}</td>
                                    <td>{element.type}</td>
                                    <td>{element.taskName}</td>
                                    <td>{element.points}</td>
                                </tr>))
                            }
                        </tbody>
                </table>
            </div>
        </div>
    </div>
}

export default Profile;
