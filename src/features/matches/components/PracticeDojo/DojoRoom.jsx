import { formatDuration } from '@domain/time/Time.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import {
  createOccupantFocusReturn,
  occupantFocusTargetId,
  occupantGroupHeadingId,
} from '@features/social-world/navigation/OccupantFocusReturn.js';

function durationLabel(value) {
  return value == null ? '—' : formatDuration(value) || '0m';
}

function activateFromKeyboard(event, action) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  action();
}

export default function DojoRoom({
  rows,
  loading,
  error,
  onInspectProfile,
}) {
  const inspectRow = (row) => onInspectProfile?.(
    row.profileId,
    row,
    createOccupantFocusReturn({ surface: 'dojo-room', profileId: row.profileId }),
  );

  return (
    <section className="dojo-room" aria-label="Dojo room">
      <header className="dojo-room__header">
        <div>
          <span>SHARED ROOM</span>
          <h2 id={occupantGroupHeadingId('dojo-room')} tabIndex="-1">Work alongside people here now</h2>
        </div>
        <strong>{rows.length} present</strong>
      </header>

      {loading && <div className="dojo-room__state" role="status">Loading…</div>}
      {!loading && error && (
        <div className="dojo-room__state dojo-room__state--error" role="status">
          The shared room is temporarily unavailable. Your Dojo session is still running.
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div className="dojo-room__state" role="status">No one else is here.</div>
      )}
      {rows.length > 0 && (
        <div className="dojo-room__roster">
          {rows.map((row) => (
            <article
              key={row.profileId}
              className={`dojo-room__occupant${row.isViewer ? ' dojo-room__occupant--viewer' : ''}`}
              data-presence-state={row.presenceState}
              id={occupantFocusTargetId('dojo-room', row.profileId)}
              role="button"
              tabIndex={0}
              onClick={() => inspectRow(row)}
              onKeyDown={(event) => activateFromKeyboard(event, () => inspectRow(row))}
              aria-label={`Inspect ${row.identity.username}. Open profile.`}
            >
              <div className="dojo-room__identity" aria-hidden="true">
                <ProfileIdentity
                  identity={row.identity}
                  meta={`${row.isViewer ? 'You · ' : ''}${row.statusLabel}`}
                  isViewer={row.isViewer}
                />
              </div>
              <dl className="dojo-room__metrics">
                <div><dt>In room</dt><dd>{durationLabel(row.elapsedHere)}</dd></div>
                <div><dt>Focused</dt><dd>{durationLabel(row.focusedMs)}</dd></div>
                <div><dt>Points</dt><dd>{Math.round(row.sessionPoints).toLocaleString()}</dd></div>
              </dl>
              <div className="dojo-room__task">
                <span>{row.taskLabel ? 'Current / recent task' : 'Session evidence'}</span>
                <strong>{row.taskLabel || 'No recorded task label'}</strong>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
