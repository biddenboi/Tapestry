import { timeAsHHMMSS } from '@domain/time/Time.js';
import { ACTION_SESSION_OUTCOME } from '@domain/continuity/ActionSession.js';
import { useTaskSession } from '@features/tasks/context/TaskSessionProvider.jsx';
import './TaskSessionDock.css';

export default function TaskSessionDock() {
  const { snapshot, expand, togglePause, settleSession } = useTaskSession();
  if (!snapshot || snapshot.mode !== 'docked') return null;
  const busy = Boolean(snapshot.submittingAction);

  return (
    <aside className="task-session-dock" aria-label="Active task session">
      <div className="task-session-dock__heading">
        <div>
          <small>{snapshot.pausedAtMs == null ? 'In session' : 'Session paused'}</small>
          <strong>{snapshot.task.name}</strong>
        </div>
        <time aria-label="Active work time">{timeAsHHMMSS(snapshot.elapsedMs)}</time>
      </div>
      <div className="task-session-dock__actions">
        <button type="button" onClick={expand} disabled={busy}>Open session</button>
        <button type="button" onClick={togglePause} disabled={busy}>
          {snapshot.pausedAtMs == null ? 'Pause' : 'Resume'}
        </button>
        <button
          type="button"
          onClick={() => settleSession({ outcome: ACTION_SESSION_OUTCOME.completed })}
          disabled={busy}
        >Finish</button>
      </div>
      {snapshot.settlementError && <p role="alert">{snapshot.settlementError}</p>}
    </aside>
  );
}
