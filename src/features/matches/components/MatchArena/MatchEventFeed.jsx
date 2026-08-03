const EVENT_LABELS = {
  lead_change: 'Lead',
  close_match: 'Close',
  comeback_warning: 'Swing',
  big_completion: 'Score',
  enemy_pending_score: 'Threat',
  team_idle_warning: 'Alert',
  mvp_shift: 'MVP',
  endgame_pressure: 'Endgame',
  team_signal: 'Team',
};

export default function MatchEventFeed({ events = [] }) {
  const visibleEvents = (events || []).slice(0, 4);

  return (
    <aside className="match-event-feed" aria-live="polite">
      <div className="mef-header">
        <span className="mef-title">Live calls</span>
        <span className="mef-count">{visibleEvents.length}</span>
      </div>
      {visibleEvents.length ? (
        <div className="mef-list">
          {visibleEvents.map((event) => (
            <div key={event.id} className={`mef-item mef-${event.severity || 'info'}`}>
              <span className="mef-type">{EVENT_LABELS[event.type] || 'Match'}</span>
              <span className="mef-message">{event.message}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mef-empty">Waiting for match activity.</div>
      )}
    </aside>
  );
}
