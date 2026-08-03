const formatEta = (ms) => {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return null;
  const minutes = Math.max(1, Math.round(value / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

export default function MatchStatusPanel({ snapshot }) {
  if (!snapshot) return null;

  const myIdx = snapshot.currentPlayerTeamIdx >= 0 ? snapshot.currentPlayerTeamIdx : 0;
  const enemyIdx = myIdx === 0 ? 1 : 0;
  const myActivity = snapshot.teamActivity?.[myIdx] || {};
  const enemyActivity = snapshot.teamActivity?.[enemyIdx] || {};
  const nextEta = [myActivity.nextCompletionMs, enemyActivity.nextCompletionMs]
    .filter((value) => Number.isFinite(Number(value)))
    .sort((a, b) => Number(a) - Number(b))[0];

  return (
    <section className={`match-status-panel msp-${snapshot.closeness} msp-${snapshot.phase}`}>
      <div className="msp-copy">
        <div className="msp-title">{snapshot.summary?.title || 'Match state'}</div>
        <div className="msp-message">{snapshot.summary?.message || 'Waiting for match activity.'}</div>
      </div>
      <div className="msp-metrics" aria-label="Match activity metrics">
        <span>{snapshot.phase}</span>
        <span>{snapshot.scoreGap.toLocaleString()} gap</span>
        <span>{myActivity.activeCount || 0} active</span>
        <span>{enemyActivity.activeCount || 0} enemy active</span>
        {nextEta != null && <span>next {formatEta(nextEta)}</span>}
      </div>
    </section>
  );
}
