import { useLocation, useNavigate } from "react-router-dom";
import './Profile.css';

function Profile() {
//read through this code again when ur not tired
  const { state } = useLocation();
  const navigate = useNavigate();
  const player = state?.player;

  if (!player) {
    navigate("/", { replace: true });
    return null;
  }

  function getDateAsString(date) {
    const hours = parseInt(date.split(":")[0]);
    const minutes = parseInt(date.split(":")[1]);

    return hours > 12 ? hours%12 + ":" + minutes + "pm" : 
    hours + ":" + minutes + "am";
  }

  return <div className="profile">
           
    <div className="profile-banner">
        <div className="stats-subsection">
            <span>{player.localCreatedAt.split("T")[0]}</span>
            <span>{player.username}</span>
            <span>{player.description ? '"'+player.description+'"' : "No Bio."}</span>
        </div>
        <div className="description-subsection">
            <div>
                
            </div>
            <div>
                <span>Final Points:</span>
                <span>{player.points}</span>
            </div>
            <div>
                <span>Completions:</span>
                <span>{player.tasks.length}</span>
            </div>
        </div>
    </div>
    <div className="task-history-display">
        <table className="task-table">
            <thead>
                <tr>
                    <th>Time</th>
                    <th>Duration</th>
                    <th>Name</th>
                    <th>Points</th>
                </tr>
                </thead>
                <tbody>
                    {
                        player.tasks.map((element, index) => (
                        <tr key={element.createdAt}>
                            <td>{getDateAsString(element.localCreatedAt.split('T')[1].split('Z')[0])}</td>
                            <td>{Math.floor(element.duration / 60000) + "m"}</td>
                            <td>{element.taskName}</td>
                            <td>{element.points}</td>
                        </tr>))
                    }
                </tbody>
            </table>
        </div>
    </div>
}

export default Profile;
