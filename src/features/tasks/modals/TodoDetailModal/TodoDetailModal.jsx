import '@features/tasks/modals/TodoDetailModal/TodoDetailModal.css';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import MarkdownEditor from '@shared/markdown-editor/MarkdownEditor.jsx';
import { UTCStringToLocalDate, UTCStringToLocalTime, formatDuration } from '@domain/time/Time.js';
import { getTaskDuration } from '@domain/tasks/Tasks.js';

const AVERSION_LABELS = { 1: 'Low', 2: 'Medium', 3: 'High' };

function formatDateTime(value) {
  if (!value) return null;
  return `${UTCStringToLocalDate(value)} ${UTCStringToLocalTime(value)}`;
}

function formatTaskSource(source) {
  if (!source) return 'Planned';
  return String(source).replace(/_/g, ' ').toUpperCase();
}

function DetailMetric({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div>
      <span className="detail-k">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default NiceModal.create(({ item }) => {
  const modal = useModal();
  const isTask = item?.completedAt != null;
  const duration = isTask ? getTaskDuration(item) : null;
  const primaryValue = item?.points != null
    ? Math.floor(Number(item.pointsBase ?? item.points) || 0).toLocaleString()
    : item?.estimatedDuration != null
      ? `${item.estimatedDuration}`
      : '--';
  const primaryLabel = item?.points != null ? 'POINTS' : 'MINUTES';
  const statusLabel = isTask ? 'Completed' : 'Queued';
  const durationLabel = duration != null ? formatDuration(duration) : null;
  const estimateLabel = item?.estimatedDuration != null ? `${item.estimatedDuration} min` : null;
  const sessionLabel = item?.sessionDuration != null ? formatDuration(item.sessionDuration) : null;
  const aversionLabel = item?.aversion != null ? AVERSION_LABELS[Math.round(Number(item.aversion))] || item.aversion : null;

  if (!modal.visible || !item) return null;

  return (
    <div className="detail-overlay">
      <div className="blanker" onClick={() => { modal.hide(); modal.remove(); }} />
      <div className="detail-card task-detail-card">
        <div className="detail-header">
          <div>
            <div className="detail-eyebrow">{isTask ? 'TASK DETAIL' : 'TODO DETAIL'}</div>
            <h2 className="detail-title">{item.name}</h2>
          </div>
          <button className="close-btn" onClick={() => { modal.hide(); modal.remove(); }}>✕</button>
        </div>

        <div className="detail-body">
          <div className={`task-detail-summary ${isTask ? 'task-detail-summary--complete' : 'task-detail-summary--queued'}`}>
            <div className="task-detail-summary-copy">
              <span className="task-detail-summary-k">{statusLabel}</span>
              <div className="task-detail-scoreline">
                <strong>{primaryValue}</strong>
                <span>{primaryLabel}</span>
              </div>
              <p>
                {isTask
                  ? [durationLabel, estimateLabel && `estimated ${estimateLabel}`, item.source && `${formatTaskSource(item.source)} source`].filter(Boolean).join(' / ')
                  : [estimateLabel, item.dueDate && `due ${UTCStringToLocalDate(item.dueDate)}`].filter(Boolean).join(' / ') || 'No schedule set.'}
              </p>
            </div>
            <span className="task-detail-source">{formatTaskSource(item.source)}</span>
          </div>

          <div className="detail-grid task-detail-stats">
            <DetailMetric label="Due" value={item.dueDate ? UTCStringToLocalDate(item.dueDate) : null} />
            <DetailMetric label="Created" value={formatDateTime(item.createdAt)} />
            <DetailMetric label="Completed" value={formatDateTime(item.completedAt)} />
            <DetailMetric label="Estimate" value={estimateLabel} />
            <DetailMetric label="Commitment" value={sessionLabel} />
            <DetailMetric label="Actual" value={durationLabel} />
            <DetailMetric label="Resistance" value={aversionLabel} />
            <DetailMetric label="Goal" value={item.goalName || item.projectName || item.projectId} />
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
        </div>
      </div>
    </div>
  );
});
