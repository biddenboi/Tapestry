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
    await endDay(databaseConnection, currentPlayer, true);
    refreshApp();
    close();
  };

  if (!modal.visible) return null;

  return (
    <div className="confirm-overlay">
      <div className="blanker" onClick={close} />
      <div className="confirm-card">
        <div className="confirm-header"><span>END DAY EARLY</span></div>
        <div className="confirm-body">
          <p className="confirm-title">End the day early?</p>
          <p className="confirm-desc">
            You will lose the ability to create additional tasks today. In exchange, only <strong>half your tokens</strong>
            will be deducted rather than the full amount.
          </p>
        </div>
        <div className="confirm-footer">
          <button onClick={close}>RETURN</button>
          <button className="danger" onClick={handleAccept}>CONFIRM END DAY</button>
        </div>
      </div>
    </div>
  );
});
