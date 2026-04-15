import '../EndDayConfirm/EndDayConfirm.css';
import './Purgatory.css';
import { useContext } from 'react';
import { AppContext } from '../../App';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import Timer from '../../Components/Timer/Timer';
import { MINUTE } from '../../utils/Constants';
import { EVENT } from '../../utils/Constants.js';
import { getMidnightOfDate, getMsUntilMidnight, getLocalDate } from '../../utils/Helpers/Time';

export default NiceModal.create(() => {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const modal = useModal();
    const { timestamp } = useContext(AppContext);

    // Check if midnight has passed and close if so
    const checkFinished = async () => {
        const sleep = await databaseConnection.getLastEventType([EVENT.sleep]);
        const midnight = getMidnightOfDate(getLocalDate(new Date()));
        if (getLocalDate(sleep.createdAt) < midnight) modal.remove();
    };

    // Trigger check on timestamp update
    if (modal.visible) checkFinished();

    return modal.visible ? (
        <div className="confirm-overlay">
            <div className="blanker" />
            <div className="purgatory-card">
                <div className="purgatory-header">PURGATORY</div>
                <div className="purgatory-body">
                    <p className="purgatory-title">You Are in Purgatory</p>
                    <p className="purgatory-sub">
                        You chose to leave early. Rest up — the new day begins at midnight.
                    </p>
                    <Timer
                        showPoints={false}
                        startTime={new Date().getTime() / MINUTE}
                        duration={getMsUntilMidnight() / MINUTE}
                    />
                </div>
            </div>
        </div>
    ) : null;
});
