const ACTIVE_STATUSES = new Set(['active', 'deep_focus', 'charging']);

const formatPoints = (points) => {
  const value = Number(points || 0);
  return value > 0 ? `+${Math.round(value).toLocaleString()}` : null;
};

export default function PlayerActivityBadge({ activity }) {
  if (!activity) return null;

  const pendingLabel = ACTIVE_STATUSES.has(activity.status)
    ? formatPoints(activity.pendingPoints)
    : activity.status === 'recent_complete'
      ? formatPoints(activity.lastCompletedPoints)
      : null;
  const showProgress = ACTIVE_STATUSES.has(activity.status)
    && Number(activity.progressRatio || 0) > 0;

  return (
    <div className={`player-activity-badge pab-${activity.status || 'idle'}`}>
      <div className="pab-main">
        <span className="pab-dot" aria-hidden="true" />
        <span className="pab-label">{activity.label || 'Idle'}</span>
        {pendingLabel && <span className="pab-points">{pendingLabel}</span>}
        {activity.confidence === 'estimated' && <span className="pab-est">EST</span>}
      </div>
      {showProgress && (
        <div className="pab-progress" aria-hidden="true">
          <div
            className="pab-progress-fill"
            style={{ width: `${Math.max(3, Math.min(100, Math.round((activity.progressRatio || 0) * 100)))}%` }}
          />
        </div>
      )}
    </div>
  );
}
