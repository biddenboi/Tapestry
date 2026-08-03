import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';

export default function DojoSessionSummary({
  currentPlayer,
  inTask,
  sessionPoints,
}) {
  const username = currentPlayer?.username || 'AGENT';
  return (
    <aside className={`dojo-pod ${inTask ? 'dojo-pod--active' : ''}`} aria-label="Your Dojo session">
      <div className="dojo-pod-glow" aria-hidden="true" />
      <ProfileIdentity
        identity={currentPlayer}
        avatarOnly
        avatarSize={96}
        isViewer
        className="dojo-avatar"
      />
      <div className="dojo-pod-name">{username}</div>
      <div className="dojo-pod-status">
        {inTask
          ? <span className="pod-status-active">⬤ IN SESSION</span>
          : <span className="pod-status-idle">◯ IN THE ROOM</span>}
      </div>
      <div className="dojo-score-display">
        <span className="dojo-score-val">{sessionPoints.toLocaleString()}</span>
        <span className="dojo-score-lbl">SESSION POINTS</span>
      </div>
    </aside>
  );
}
