import './Purgatory.css'
import { useContext, useEffect } from 'react'
import { AppContext } from '../../App';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { endDay } from '../../utils/Helpers/Events';
import Timer from '../../Components/Timer/Timer';
import { DAY, MINUTE } from '../../utils/Constants';
import { EVENT } from '../../utils/Constants.js';
import { getMidnightOfDate, getMsUntilMidnight, getLocalDate, UTCStringToLocalDate } from '../../utils/Helpers/Time';

export default NiceModal.create(() => {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const modal = useModal()

    useEffect(() => {
        const checkFinished = async () => {
            const sleep = await databaseConnection.getLastEventType([EVENT.sleep]);

            const midnight = getMidnightOfDate(getLocalDate(new Date()));
            
            if (UTCStringToLocalDate(sleep.createdAt) < midnight) {
                modal.remove();
            }
        }
        checkFinished();
    }, [useContext(AppContext).timestamp])

    return modal.visible ? <div className="end-day-confirm">
        <div className="blanker"></div>
        <div className="container">
            <p>You are in Purgatory.</p>
            <span>You have selected to leave early. Come back tomorrow.</span>
            <Timer showPoints={false} 
             startTime={new Date().getTime() / MINUTE}
             duration={getMsUntilMidnight() / MINUTE}/> 
        </div>
    </div> : ""
})
