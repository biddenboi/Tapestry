import './StartDayPopup.css'
import { useContext, useEffect } from 'react'
import { AppContext } from '../../App.jsx';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import Timer from '../../Components/Timer/Timer.jsx';
import { DAY, MINUTE } from '../../utils/Constants.js';
import { EVENT } from '../../utils/Constants.js';
import { getMidnightOfDate, getMsUntilMidnight, getLocalDate } from '../../utils/Helpers/Time.js';

export default NiceModal.create(() => {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const modal = useModal()

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
