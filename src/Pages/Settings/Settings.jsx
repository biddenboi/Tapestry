import { useContext, useMemo, useState, useEffect } from 'react';
import { DatabaseConnectionContext } from '../../App';

import './Settings.css'
import PlayerDatabase from "../../network/Database/PlayerDatabase";
import TaskDatabase from '../../network/Database/TaskDatabase';

function Settings() {
    /*Internal Data*/
    const [playerFileData, setPlayerFileData] = useState(null);
    const [taskFileData, setTaskFileData] = useState(null);
    const [usernamePlaceholderText, setUsernamePlaceholderText] = useState("");
    const [descriptionPlaceholderText, setDescriptionPlaceholderText] = useState("");

    const databaseConnection = useContext(DatabaseConnectionContext);

    const playerDatabase = useMemo(
        () => new PlayerDatabase(databaseConnection)
        ,[databaseConnection]
    );
    const taskDatabase = useMemo(
        () => new TaskDatabase(databaseConnection)
        ,[databaseConnection]
    );

    
    useEffect(() => {
        const updatePlaceholder = async () => {
            const date = new Date().toLocaleString('sv').split(' ')[0];
            const player = await playerDatabase.getPlayer(date);

            setUsernamePlaceholderText(player.username);
            setDescriptionPlaceholderText(player.description);
        }

        updatePlaceholder();
    }, [playerDatabase])

    /* Helper Methods */

    const handleSubmit = async (e) => {
        e.preventDefault();
        const date = new Date().toLocaleString('sv').split(' ')[0];
        const player = await playerDatabase.getPlayer(date);
    
        const formData = new FormData(e.target);
    
        const newPlayer = {
            username: formData.get("username") === "" ? player.username : formData.get("username"),
            createdAt: new Date().toISOString(),
            localCreatedAt: new Date().toLocaleString('sv').split(' ')[0],
            description: formData.get("description") === "" ? player.description : formData.get("description")
        }
        await playerDatabase.putPlayer(newPlayer);
    }

    //task data interaction methods
    const handleTaskUpload = async (e) => {
    
        const tasksAsJSONString = await taskFileData.text();
        taskDatabase.clearTaskData();
    
        JSON.parse(tasksAsJSONString).forEach((task) => {
          taskDatabase.addTaskLog(task);
        })
      } 
      
      const handleTaskDownload = async (e) => {
        await taskDatabase.getDataAsJSON();
      }

      //player data interaction methods
      const handlePlayerUpload = async (e) => {
    
        const playersAsJSONString = await playerFileData.text();
        playerDatabase.clearPlayerData();
    
        JSON.parse(playersAsJSONString).forEach((player) => {
            playerDatabase.putPlayer(player);
        })
      } 

    const handlePlayerDownload = async (e) => {
        await playerDatabase.getDataAsJSON();
    }

    /* Components */

    function SettingsGroup(category, inputs) {
    return <div className="settings-group">
        <h3>{category}</h3>
        <hr />
        {inputs}
    </div>
    }
      

    return <form onSubmit={handleSubmit} className="settings">
        {SettingsGroup("Personal",
            <>
                <label className="username-settings">
                    Username:
                    <input 
                        type="text" 
                        placeholder={usernamePlaceholderText} 
                        name="username"/>
                </label>  
                <label className="description-settings">
                    Description:
                    <input 
                        type="text" 
                        placeholder={descriptionPlaceholderText} 
                        name="description"/>
                </label>  
            </>
        )}

        <hr />

        <button className="save-changes">Save Changes</button>

        <br />

        {SettingsGroup("Data",
            <>
                <label>
                    Download Task Data:
                    <button type="button" onClick={handleTaskDownload}>Download</button>
                </label>  
                <label>
                    Download Player Data:
                    <button type="button" onClick={handlePlayerDownload}>Download</button>
                </label>  
                <label>
                    Upload Task Data:
                    <div>
                        <input type="file" 
                        accept=".json" 
                        onChange={
                            async e => setTaskFileData(e.target.files[0])
                        }/>
                        <button type="button" onClick={handleTaskUpload}>Upload</button>
                    </div>
                </label>  
                <label>
                    Upload Player Data:
                    <div>
                        <input type="file" 
                        accept=".json" 
                        onChange={
                            async e => setPlayerFileData(e.target.files[0])
                        }/>
                        <button type="button" onClick={handlePlayerUpload}>Upload</button>
                    </div>
                </label>  
            </>
        )}
    </form>
}



export default Settings;