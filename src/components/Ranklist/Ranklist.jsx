import './Ranklist.css'
import { Link } from 'react-router-dom';
import { AppContext } from '../../App.jsx';
import { useState, useEffect, useContext } from 'react'
import { STORES } from '../../utils/Constants';



export default function RankListComponent() {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const [playerPoints, setPlayerPoints] = useState([]);

    useEffect(() => {
        const reload = async () => {
            const players = await databaseConnection.getAll(STORES.player);
        
            const DataPromises = players.map(async (player) => {
            const tasks = await databaseConnection.getRelativePlayerStore(STORES.task, player);
                    
            let sum = 0;
            tasks.forEach(task => {
                sum += (task.points || 0);
            });
            
            return {
                ...player,
                points: sum,
                };
            });
            
            const results = await Promise.all(DataPromises);
            results.sort((a, b) => b.points - a.points);
            setPlayerPoints(results);
        }

        reload();
    }, [databaseConnection, useContext(AppContext).timestamp])
    

    return <div className="rank-list">
      <table className="rank-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Username</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          {
            playerPoints.map((element, index) => (
              <tr key={element.createdAt}>
                <td>{"#" + (index + 1)}</td>
                <td>
                  <Link 
                    to={`/profile/${element.UUID}`}>
                    {element.username}
                  </Link>
                </td>
                <td>{element.points}</td>
              </tr>))
          }
        </tbody>
      </table>
    </div>
}