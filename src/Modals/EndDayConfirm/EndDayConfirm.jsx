import './EndDayConfirm.css';
import { useContext } from 'react';
import { AppContext } from '../../App';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { endDay } from '../../utils/Helpers/Events';

export default NiceModal.create(() => {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const modal = useModal();

    const handleAccept = async () => {
        modal.remove();
        const currentPlayer = await databaseConnection.getCurrentPlayer();
        endDay(databaseConnection, currentPlayer, true);
    };

    const handleCancel = () => {
        modal.hide();
        modal.remove();
    };

    return modal.visible ? (
        <div className="confirm-overlay">
            <div className="blanker" onClick={handleCancel} />
            <div className="confirm-card">
                <div className="confirm-header">
                    <span>END DAY EARLY</span>
                </div>
                <div className="confirm-body">
                    <p className="confirm-title">End the day early?</p>
                    <p className="confirm-desc">
                        You will lose the ability to create additional tasks today.
                        In exchange, only <strong>half your tokens</strong> will be deducted rather
                        than the full amount.
                    </p>
                </div>
                <div className="confirm-footer">
                    <button onClick={handleCancel}>RETURN</button>
                    <button className="danger" onClick={handleAccept}>CONFIRM END DAY</button>
                </div>
            </div>
        </div>
    ) : null;
});
