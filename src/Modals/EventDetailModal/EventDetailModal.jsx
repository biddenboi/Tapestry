import './EventDetailModal.css';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { UTCStringToLocalDate, UTCStringToLocalTime } from '../../utils/Helpers/Time.js';

export default NiceModal.create(({ item }) => {
  const modal = useModal();
  if (!modal.visible || !item) return null;

  const timestamp = item.createdAt || item.completedAt;
  const title = item.description || item.title || item.name || 'Activity detail';

  return (
    <div className="detail-overlay">
      <div className="blanker" onClick={() => { modal.hide(); modal.remove(); }} />
      <div className="detail-card">
        <div className="detail-header">
          <div>
            <div className="detail-eyebrow">ACTIVITY DETAIL</div>
            <h2 className="detail-title">{title}</h2>
          </div>
          <button className="close-btn" onClick={() => { modal.hide(); modal.remove(); }}>✕</button>
        </div>

        <div className="detail-body">
          <div className="detail-grid">
            {item.type && (
              <div>
                <span className="detail-k">Type</span>
                <strong>{String(item.type).replace(/_/g, ' ')}</strong>
              </div>
            )}
            {timestamp && (
              <div>
                <span className="detail-k">When</span>
                <strong>{UTCStringToLocalDate(timestamp)} {UTCStringToLocalTime(timestamp)}</strong>
              </div>
            )}
            {item.parent && (
              <div>
                <span className="detail-k">Profile</span>
                <strong>{item.parent}</strong>
              </div>
            )}
          </div>

          <div className="detail-section">
            <div className="detail-k">Details</div>
            <p className="detail-copy">{item.description || item.title || item.name || 'No additional details.'}</p>
          </div>
        </div>
      </div>
    </div>
  );
});
