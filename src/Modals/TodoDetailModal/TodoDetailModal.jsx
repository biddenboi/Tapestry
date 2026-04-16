import './TodoDetailModal.css';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import MarkdownEditor from '../../components/MarkdownEditor/MarkdownEditor.jsx';
import { UTCStringToLocalDate, UTCStringToLocalTime, formatDuration } from '../../utils/Helpers/Time.js';
import { getTaskDuration } from '../../utils/Helpers/Tasks.js';

function locationToLatLng(location) {
  if (!location) return null;
  if (typeof location === 'string') {
    const match = location.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    if (!match) return null;
    return { latitude: Number(match[1]), longitude: Number(match[2]) };
  }
  if (typeof location === 'object' && location.latitude != null && location.longitude != null) {
    return { latitude: Number(location.latitude), longitude: Number(location.longitude) };
  }
  return null;
}

function MapPreview({ location }) {
  const latLng = locationToLatLng(location);
  if (!latLng || typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const query = `${latLng.latitude},${latLng.longitude}`;
  const embedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=14&output=embed`;
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(query)}`;

  return (
    <div className="detail-map-wrap">
      <div className="detail-map-label">Location</div>
      <iframe title="Task location" className="detail-map" src={embedUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
      <a href={mapsUrl} target="_blank" rel="noreferrer" className="detail-map-link">Open in Google Maps</a>
    </div>
  );
}

export default NiceModal.create(({ item }) => {
  const modal = useModal();
  const isTask = item?.completedAt != null;
  const duration = isTask ? getTaskDuration(item) : null;

  if (!modal.visible || !item) return null;

  return (
    <div className="detail-overlay">
      <div className="blanker" onClick={() => { modal.hide(); modal.remove(); }} />
      <div className="detail-card">
        <div className="detail-header">
          <div>
            <div className="detail-eyebrow">{isTask ? 'TASK DETAIL' : 'TODO DETAIL'}</div>
            <h2 className="detail-title">{item.name}</h2>
          </div>
          <button className="close-btn" onClick={() => { modal.hide(); modal.remove(); }}>✕</button>
        </div>

        <div className="detail-body">
          <div className="detail-grid">
            {item.dueDate && <div><span className="detail-k">Due</span><strong>{UTCStringToLocalDate(item.dueDate)}</strong></div>}
            {item.createdAt && <div><span className="detail-k">Created</span><strong>{UTCStringToLocalDate(item.createdAt)} {UTCStringToLocalTime(item.createdAt)}</strong></div>}
            {item.completedAt && <div><span className="detail-k">Completed</span><strong>{UTCStringToLocalDate(item.completedAt)} {UTCStringToLocalTime(item.completedAt)}</strong></div>}
            {item.estimatedDuration != null && <div><span className="detail-k">Estimate</span><strong>{item.estimatedDuration} min</strong></div>}
            {item.sessionDuration != null && <div><span className="detail-k">Session</span><strong>{item.sessionDuration} min</strong></div>}
            {duration != null && <div><span className="detail-k">Actual</span><strong>{formatDuration(duration)}</strong></div>}
            {item.points != null && <div><span className="detail-k">Points</span><strong>{item.points}</strong></div>}
          </div>

          {item.reasonToSelect && (
            <div className="detail-section">
              <div className="detail-k">Why this task</div>
              <p className="detail-copy">{item.reasonToSelect}</p>
            </div>
          )}

          {item.efficiency && (
            <div className="detail-section">
              <div className="detail-k">Plan</div>
              <MarkdownEditor value={item.efficiency} readOnly />
            </div>
          )}

          <MapPreview location={item.location} />
        </div>
      </div>
    </div>
  );
});
