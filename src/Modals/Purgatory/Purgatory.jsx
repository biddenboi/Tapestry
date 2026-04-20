import '../EndDayConfirm/EndDayConfirm.css';
import './Purgatory.css';
import { useContext, useEffect } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import Timer from '../../components/Timer/Timer.jsx';
import { MINUTE, EVENT } from '../../utils/Constants.js';
import { getMidnightOfDate, getMsUntilMidnight, getLocalDate } from '../../utils/Helpers/Time.js';

export default NiceModal.create(() => {
  const { databaseConnection, timestamp, refreshApp } = useContext(AppContext);
  const modal = useModal();

  useEffect(() => {
    const checkFinished = async () => {
      const sleep = await databaseConnection.getLastEventType([EVENT.sleep]);
      if (!sleep) return;
      const midnight = getMidnightOfDate(getLocalDate(new Date()));
      if (getLocalDate(new Date(sleep.createdAt)) < midnight) {
        modal.remove();
        refreshApp(); // Immediately triggers syncDay → startDay
      }
    };
    if (modal.visible) checkFinished();
  }, [databaseConnection, modal, timestamp, refreshApp]);

  if (!modal.visible) return null;

  return (
    <div className="confirm-overlay">
      <div className="blanker" />
      <div className="purgatory-card">
        <div className="purgatory-header">PURGATORY</div>
        <div className="purgatory-body">
          <p className="purgatory-title">You Are in Purgatory</p>
          <p className="purgatory-sub">Rest up — the new day begins at midnight.</p>
          <Timer showPoints={false} startTime={Date.now()} duration={getMsUntilMidnight() / MINUTE} />
        </div>
      </div>
    </div>
  );
});
