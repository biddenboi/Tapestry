import './EndDayConfirm.css';
import { useContext } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { endDay } from '../../utils/Helpers/Events.js';

export default NiceModal.create(() => {
  const { databaseConnection, currentPlayer, refreshApp } = useContext(AppContext);
  const modal = useModal();

  const close = () => {
    modal.hide();
    modal.remove();
  };

  const handleAccept = async () => {
    await endDay(databaseConnection, currentPlayer, false);
    refreshApp();
    close();
  };

  if (!modal.visible) return null;

  return (
    <div className="confirm-overlay">
      <div className="blanker" onClick={close} />
      <div className="confirm-card">
        <div className="confirm-header"><span>END DAY</span></div>
        <div className="confirm-body">
          <p className="confirm-title">End the day now?</p>
          <p className="confirm-desc">
            Ending the day manually will <strong>preserve all your tokens</strong>.
            If you miss your scheduled sleep time, all tokens are forfeited — so end the day before then!
          </p>
        </div>
        <div className="confirm-footer">
          <button onClick={close}>RETURN</button>
          <button className="primary" onClick={handleAccept}>CONFIRM END DAY</button>
        </div>
      </div>
    </div>
  );
});
