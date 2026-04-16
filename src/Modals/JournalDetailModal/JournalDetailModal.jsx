import './JournalDetailModal.css';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { UTCStringToLocalDate, UTCStringToLocalTime } from '../../utils/Helpers/Time.js';

export default NiceModal.create(({ item }) => {
  const modal = useModal();
  if (!modal.visible || !item) return null;

  return (
    <div className="detail-overlay">
      <div className="blanker" onClick={() => { modal.hide(); modal.remove(); }} />
      <div className="detail-card">
        <div className="detail-header">
          <div>
            <div className="detail-eyebrow">JOURNAL ENTRY</div>
            <h2 className="detail-title">{item.title || 'Untitled entry'}</h2>
          </div>
          <button className="close-btn" onClick={() => { modal.hide(); modal.remove(); }}>✕</button>
        </div>
        <div className="detail-body">
          <div className="detail-section">
            <span className="detail-k">Created</span>
            <strong>{UTCStringToLocalDate(item.createdAt)} {UTCStringToLocalTime(item.createdAt)}</strong>
          </div>
          <div className="detail-section detail-journal-copy">{item.entry || 'No entry text.'}</div>
        </div>
      </div>
    </div>
  );
});
