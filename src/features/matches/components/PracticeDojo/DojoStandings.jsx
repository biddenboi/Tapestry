import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';

function activateFromKeyboard(event, action) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  action();
}

function DojoTopSessions({ sessions, currentPlayerId, onInspectProfile }) {
  return (
    <section className="dojo-leaderboard" aria-label="Top Dojo sessions">
      <div className="dojo-lb-title">TOP SESSIONS</div>
      <div className="dojo-lb-sub">Historical session totals</div>
      {sessions.length === 0 ? (
        <div className="dojo-lb-empty">Complete tasks to appear here.</div>
      ) : (
        <div className="dojo-lb-list">
          {sessions.map((session, index) => {
            const isSelf = session.playerId === currentPlayerId;
            return (
              <article
                key={session.sessionId}
                className={`dojo-lb-row${isSelf ? ' dojo-lb-row--self' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onInspectProfile?.(session.playerId)}
                onKeyDown={(event) => activateFromKeyboard(event, () => onInspectProfile?.(session.playerId))}
                aria-label={`Open ${session.identity?.username || 'player'} profile`}
              >
                <span className={`dojo-lb-rank${index < 3 ? ` dojo-lb-rank--${index + 1}` : ''}`}>{session.rankLabel}</span>
                <div className="dojo-lb-info">
                  <ProfileIdentity identity={session.identity} compact isViewer={isSelf} />
                  <span className="dojo-lb-date">
                    {session.lastActivityAt
                      ? new Date(session.lastActivityAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : '—'}
                  </span>
                </div>
                <span className="dojo-lb-pts">
                  {Math.floor(session.points).toLocaleString()} <span className="dojo-lb-pts-lbl">pts</span>
                </span>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StandingRow({ row, onInspectProfile }) {
  const inspect = () => onInspectProfile?.(row.playerId);
  return (
    <article
      className={`dojo-standing-row${row.isViewer ? ' dojo-standing-row--viewer' : ''}${row.isFriend ? ' dojo-standing-row--friend' : ''}`}
      data-session-status={row.status}
      role="button"
      tabIndex={0}
      onClick={inspect}
      onKeyDown={(event) => activateFromKeyboard(event, inspect)}
      aria-label={`Open ${row.identity?.username || 'player'} profile`}
    >
      <strong className="dojo-standing-row__rank">{row.rankLabel}</strong>
      <ProfileIdentity identity={row.identity} meta={row.contextLabel} compact rank="compact" isViewer={row.isViewer} />
      <div className="dojo-standing-row__session">
        <span>{row.sessionLabel}</span>
        <strong>{Math.floor(row.points).toLocaleString()} pts</strong>
      </div>
      {(row.isFriend || (row.isCast && !row.isViewer)) && (
        <span className="dojo-standing-row__badge">{row.isFriend ? 'FRIEND' : 'CAST'}</span>
      )}
    </article>
  );
}

export default function DojoStandings({
  controller,
  onInspectProfile,
  topSessions = [],
  currentPlayerId = null,
}) {
  const { current, around, loading, error, updating } = controller;
  return (
    <section className="dojo-standings" aria-label="Dojo standings">
      <header className="dojo-standings__header">
        <div>
          <span>COMPETITIVE CONTEXT</span>
          <h2>Your level, not only the top</h2>
        </div>
        <strong data-updating={updating ? 'true' : 'false'}>
          {updating ? 'Ranks updating…' : 'Ranks current'}
        </strong>
      </header>

      {loading && !current && <div className="dojo-standings__state" role="status">Locating your standing…</div>}
      {!loading && error && (
        <div className="dojo-standings__state dojo-standings__state--error" role="status">
          Standings are temporarily unavailable. Your Dojo session is still running.
        </div>
      )}
      {!error && (
        <div className="dojo-standings__content">
          <section className="dojo-current-standing">
            <span className="dojo-current-standing__eyebrow">CURRENT SESSION</span>
            {current ? (
              <>
                <div className="dojo-current-standing__rank">{current.rankLabel}</div>
                <ProfileIdentity identity={current.identity} meta={current.contextLabel} rank="compact" isViewer />
                <strong>{Math.floor(current.points).toLocaleString()} points</strong>
                <span className="dojo-current-standing__status" data-status={current.status}>
                  {current.sessionLabel}
                </span>
              </>
            ) : (
              <>
                <div className="dojo-current-standing__rank">—</div>
                <strong>Session is being indexed</strong>
                <span className="dojo-current-standing__status" data-status="provisional">
                  Provisional · no points yet
                </span>
              </>
            )}
          </section>

          <section className="dojo-around-standing">
            <div className="dojo-around-standing__title">
              <div><span>AROUND YOU</span><strong>Two above · two below</strong></div>
              <small>{around.length} indexed positions</small>
            </div>
            {around.length ? (
              <div className="dojo-around-standing__list">
                {around.map((row) => (
                  <StandingRow key={row.sessionId} row={row} onInspectProfile={onInspectProfile} />
                ))}
              </div>
            ) : (
              <div className="dojo-around-standing__empty">
                {updating ? 'Your ranking neighborhood will appear after this update.' : 'Complete a session to establish nearby positions.'}
              </div>
            )}
          </section>
          <DojoTopSessions
            sessions={topSessions}
            currentPlayerId={currentPlayerId}
            onInspectProfile={onInspectProfile}
          />
        </div>
      )}
    </section>
  );
}
