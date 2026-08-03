import { useState } from 'react';
import { ACTION_SESSION_OUTCOME } from '../../../../domain/continuity/ActionSession.js';
import { formatDuration } from '../../../../domain/time/Time.js';

export default function ActiveTaskMove({
  snapshot,
  onExpand,
  onTogglePause,
  onSettle,
}) {
  const [blocking, setBlocking] = useState(false);
  const [blockerType, setBlockerType] = useState('unclear');
  const [nextStep, setNextStep] = useState('');
  if (!snapshot) return null;
  return (
    <section className="next-move-active-task">
      <span className="next-move-kicker">Current move</span>
      <h2>{snapshot.task?.name || 'Task session'}</h2>
      <strong className="next-move-active-task__time">
        {formatDuration(snapshot.elapsedMs) || 'Less than a minute'} active
      </strong>
      {snapshot.matchPromiseScore && (
        <div className="next-move-active-task__promise" aria-label="Live Match promise progress">
          <span>
            Match promise · {formatDuration(snapshot.matchPromiseScore.activeDurationMs)} / {' '}
            {formatDuration(snapshot.matchPromiseScore.promisedMs)}
          </span>
          <strong>
            {Math.floor(Number(snapshot.matchPromiseScore.points) || 0).toLocaleString()} Match points
          </strong>
          {snapshot.matchScoreFinalizedAt && <small>Match score frozen</small>}
        </div>
      )}
      <div className="next-move-active-task__controls">
        <button type="button" className="primary" onClick={onExpand}>Open full session</button>
        <button type="button" onClick={onTogglePause}>
          {snapshot.pausedAtMs == null ? 'Pause' : 'Resume'}
        </button>
      </div>
      {!blocking ? (
        <div className="next-move-active-task__outcomes">
          <button type="button" onClick={() => onSettle({ outcome: ACTION_SESSION_OUTCOME.progressed })}>
            Progress
          </button>
          <button type="button" onClick={() => setBlocking(true)}>Blocked</button>
          <button
            type="button"
            className="primary"
            onClick={() => onSettle({ outcome: ACTION_SESSION_OUTCOME.completed })}
          >
            Finish
          </button>
        </div>
      ) : (
        <div className="next-move-active-task__blocker">
          <label>
            What is blocking the next move?
            <select value={blockerType} onChange={(event) => setBlockerType(event.target.value)}>
              <option value="unclear">Next step unclear</option>
              <option value="person">Waiting on a person</option>
              <option value="information">Missing information</option>
              <option value="technical">Technical problem</option>
              <option value="environment">Environment unavailable</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Context to preserve
            <input value={nextStep} onChange={(event) => setNextStep(event.target.value)} maxLength={500} />
          </label>
          <footer>
            <button type="button" onClick={() => setBlocking(false)}>Cancel</button>
            <button
              type="button"
              className="primary"
              onClick={() => onSettle({
                outcome: ACTION_SESSION_OUTCOME.blocked,
                blockerType,
                nextStep,
              })}
            >
              Save blocker
            </button>
          </footer>
        </div>
      )}
      {snapshot.settlementError && <p className="next-move-error" role="alert">{snapshot.settlementError}</p>}
    </section>
  );
}
