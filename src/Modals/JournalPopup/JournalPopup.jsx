import { AppContext } from "../../App";
import { useContext, useEffect } from "react";
import { v4 as uuid } from "uuid";
import './JournalPopup.css'
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { STORES } from '../../utils/Constants'

export default NiceModal.create(({title}) => {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const modal = useModal()

    useEffect(() => {
        //REVIEW
        const handleKeyDown = (e) => {
            if (e.key === "Escape") {
                modal.hide()
                modal.remove();
            }
        };
    
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, []);

    const handleJournalSubmit = (async (e) => {
        //prevent default needed so data does not refresh on click.
        e.preventDefault()
        const form = e.currentTarget;
        const formData = new FormData(form);

        const entryTitle = formData.get("entry-title");
        const entryText = formData.get("entry-text");
    
        const parent = await databaseConnection.getCurrentPlayer();

        const journal = {
            title: entryTitle,
            entry: entryText,
            //create methods for local time for tasks too in helper
            createdAt: new Date().toISOString(),
            parent: parent.UUID,
            UUID: uuid(),
        }
        e.target.reset();
        modal.hide()
        await databaseConnection.add(STORES.journal, journal);
    })

    return modal.visible ? (<div className="journal-popup"
        title="Entry Popup">
        <div className="blanker"></div>
        <div className="content">
            <p>Entry</p>
            <form action="" onSubmit={handleJournalSubmit}>
                <input type="text" name="entry-title" 
                    defaultValue={title ? title : ""} 
                    placeholder={title ? title : "Entry Title"}/>
                <textarea name="entry-text" id=""
                    placeholder="Enter your log here..."></textarea>
            <button type="submit">Publish</button>
        </form>
        </div>
    </div>) : ""
}) 
