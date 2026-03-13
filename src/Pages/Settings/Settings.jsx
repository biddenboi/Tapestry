import { useContext, useState, useEffect } from 'react';
import { DatabaseConnectionContext } from '../../App';
import { v4 as uuid } from "uuid";

import './Settings.css'

function Settings() {
    /*Internal Data*/
    const [data, setData] = useState(null);
    const [usernamePlaceholderText, setUsernamePlaceholderText] = useState("");
    const [descriptionPlaceholderText, setDescriptionPlaceholderText] = useState("");

    const databaseConnection = useContext(DatabaseConnectionContext);

    
    useEffect(() => {
        const updatePlaceholder = async () => {
            const player = await databaseConnection.getCurrentPlayer();

            setUsernamePlaceholderText(player.username);
            setDescriptionPlaceholderText(player.description);
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
        }
        await databaseConnection.putPlayer(newPlayer);
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
        const player = {
            username: "Guest",
            UUID: uuid(),
            createdAt: new Date().toISOString(),
        }
        await databaseConnection.addPlayer(player);
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