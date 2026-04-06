import { useContext, useState, useEffect } from 'react';
import { AppContext } from '../../App';
import { v4 as uuid } from "uuid";
import { STORES } from '../../utils/Constants.js'

import './Settings.css'

function Settings() {
    /*Internal Data*/
    const [data, setData] = useState(null);
    const [placeholder, setPlaceholder] = useState({});

    const databaseConnection = useContext(AppContext).databaseConnection;

    useEffect(() => {
        const updatePlaceholder = async () => {
            const player = await databaseConnection.getCurrentPlayer();

            setPlaceholder({
                username: player.username,
                description: player.description,
                wakeTime: player.wakeTime,
                sleepTime: player.sleepTime,
            });
            
        }

        updatePlaceholder();
    }, [databaseConnection])

    /* Helper Methods */

    const handleSubmit = async (e) => {
        e.preventDefault();
        const player = await databaseConnection.getCurrentPlayer();
    
        const formData = new FormData(e.target);
    
        const newPlayer = {
            ...player,
            username: formData.get("username") === "" ? player.username : formData.get("username"),
            description: formData.get("description") === "" ? player.description : formData.get("description"),
            wakeTime: formData.get("wake-time"),
            sleepTime: formData.get("sleep-time"),
        }
        await databaseConnection.add(STORES.player, newPlayer);
    }
      
    const handleDataDownload = async (e) => {
        await databaseConnection.getDataAsJSON();
    }

    /* Components */
    const handleDataUpload = async (e) => {
        const JSONfileData = await data.text();
        await databaseConnection.dataUpload(JSONfileData);
    }

    function SettingsGroup(category, inputs) {
        return <div className="settings-group">
            <h3>{category}</h3>
            <hr />
            {inputs}
        </div>
    }

    const handleProfileCreation = async (e) => {
        // will fail if no player data: BUG
        const currentPlayer = await databaseConnection.getCurrentPlayer();
        if (currentPlayer) {
            await databaseConnection.add(STORES.player, {
            ...currentPlayer,
            completedAt:  new Date().toISOString()
            })
        }
        const player = {
            username: "Guest",
            UUID: uuid(),
            createdAt: new Date().toISOString(),
            wakeTime: "07:00",
            sleepTime: "23:00",
            tokens: 0,
            elo:0,
            minutesWorkedToday: 0
        }
        await databaseConnection.add(STORES.player, player);
    }
      

    return <form onSubmit={handleSubmit} className="settings">
        {SettingsGroup("Personal",
            <>
                <label className="username-settings">
                    Username:
                    <input 
                        type="text" 
                        placeholder={placeholder.username} 
                        name="username"/>
                </label>  
                <label className="description-settings">
                    Description:
                    <input 
                        type="text" 
                        placeholder={placeholder.description} 
                        name="description"/>
                </label>  
                <label className="wake-settings">
                    Wake Time:
                    <input 
                        type="time" 
                        defaultValue={placeholder.wakeTime} 
                        name="wake-time"/>
                </label>  
                <label className="sleep-settings">
                    Bed Time:
                    <input 
                        type="time" 
                        defaultValue={placeholder.sleepTime} 
                        name="sleep-time"/>
                </label>  
            </>
        )}

        <hr />

        <button className="save-changes">Save Changes</button>

        <br />

        {SettingsGroup("Data",
            <>
                <label>
                    Create Profile:
                    <button type="button" onClick={handleProfileCreation}>New</button>
                </label>  
                <label>
                    Download Data:
                    <button type="button" onClick={handleDataDownload}>Download</button>
                </label>  
                <label>
                    Upload Data:
                    <div>
                        <input type="file" 
                        accept=".json" 
                        onChange={
                            async e => setData(e.target.files[0])
                        }/>
                        <button type="button" onClick={handleDataUpload}>Upload</button>
                    </div>
                </label>  
            </>
        )}
    </form>
}



export default Settings;