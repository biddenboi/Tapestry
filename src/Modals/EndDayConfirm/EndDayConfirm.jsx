import './EndDayConfirm.css'
import { useContext, useEffect } from 'react'
import { AppContext } from '../../App';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { endDay } from '../../utils/Helpers/Events';

export default NiceModal.create(() => {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const modal = useModal()

    useEffect(() => {
        const handleKeyDown = (e) => {
          if (e.key === "Escape") {
            modal.hide()
            modal.remove();
          }
        };
          
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, []);

    const handleAccept = async () => {
        modal.remove();
        const currentPlayer = await databaseConnection.getCurrentPlayer();
        endDay(databaseConnection, currentPlayer, true)
    }

    return modal.visible ? <div className="end-day-confirm">
        <div className="blanker"></div>
        <div className="container">
            <p>Confirm End Day?</p>
            <span>End the day early, losing your ability to create additional tasks, in exchange for only half your tokens reduced?</span>
            <div className="button-row">
                <button onClick={() => modal.remove()}>Return</button>
                <button onClick={handleAccept}>Confirm</button>
            </div>
        </div>
    </div> : ""
})
