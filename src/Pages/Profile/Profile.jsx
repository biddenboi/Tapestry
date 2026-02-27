import { useLocation, useNavigate } from "react-router-dom";

import './Profile.css';
import { getTimeAsString } from "../../Helpers";

function Profile() {
//read through this code again when ur not tired
  const { state } = useLocation();
  const navigate = useNavigate();
  const player = state?.player;

  if (!player) {
    navigate("/", { replace: true });
    return null;
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
                            <td>{getTimeAsString(element.createdAt)}</td>
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
