import { formatDuration, timeAsHHMMSS } from '@domain/time/Time.js';
import MarkdownEditor from '@shared/markdown-editor/MarkdownEditor.jsx';
import { useTaskSession } from '@features/tasks/context/TaskSessionProvider.jsx';
import SessionOutcomeForm from '@features/tasks/components/SessionOutcomeForm/SessionOutcomeForm.jsx';

export default function TaskSessionExpanded() {
  const {
    snapshot,
    minimize,
    togglePause,
    settleSession,
  } = useTaskSession();
  if (!snapshot || snapshot.mode !== 'expanded') return null;

  const {
    task,
    committedMs,
    commitmentMet,
    pausedAtMs,
    submittingAction,
    settlementError,
    canMinimize,
    matchPromiseScore,
    matchScoreFinalizedAt,
  } = snapshot;
  const timerClass = 'session-elapsed';

  return (
    <div className="task-modal-overlay">
      <div className="blanker" />
      <div className="task-modal session-modal">
        <div className="session-identity">
          <div className="session-heading-row">
            <div>
              <div className="session-eyebrow">In Session</div>
              <p className="session-task-name">{task.name}</p>
            </div>
            {canMinimize && <button
              type="button"
              className="session-minimize"
              onClick={minimize}
              disabled={!!submittingAction}
              aria-label="Minimize task session to dock"
            >
              Minimize session
            </button>}
          </div>
          {task.reasonToSelect && <p className="session-task-reason">{task.reasonToSelect}</p>}
          {task.efficiency && (
            <div className="session-description">
              <MarkdownEditor value={task.efficiency} readOnly />
            </div>
          )}
        </div>

        <div className="session-timer-block">
          <div
            className="session-timer-wheel"
            style={{ '--session-progress': `${snapshot.progressRatio * 100}%` }}
          >
            <div className="session-timer-wheel__inner">
              <span className="session-timer-mode">{snapshot.timerModeLabel}</span>
              <span className={timerClass}>{timeAsHHMMSS(snapshot.timerDisplayMs)}</span>
              <span className="session-commitment-status">
                {committedMs <= 0
                  ? (pausedAtMs == null ? 'Active work time' : 'Session paused')
                  : commitmentMet
                    ? 'Optional focus boundary reached'
                    : pausedAtMs == null ? 'Working toward an optional boundary' : 'Session paused'}
              </span>
              {committedMs > 0 && (
                <span className="session-timer-sub">
                  {`${formatDuration(committedMs)} focus boundary`}
                </span>
              )}
            </div>
          </div>
          {matchPromiseScore && (
            <div className="session-match-promise" aria-label="Live Match promise progress">
              <span>MATCH PROMISE</span>
              <strong>
                {formatDuration(matchPromiseScore.activeDurationMs)} of {' '}
                {formatDuration(matchPromiseScore.promisedMs)} active
              </strong>
              <p>Scoring modifiers stay hidden during Match play.</p>
              <small>
                {matchScoreFinalizedAt
                  ? `Match score frozen at ${Math.floor(Number(matchPromiseScore.points) || 0).toLocaleString()} points.`
                  : matchPromiseScore.promiseMet
                    ? 'Promise honored; its duration bonus is active.'
                    : 'Reach the promise to earn its hidden duration bonus.'}
              </small>
            </div>
          )}
        </div>

        <div className="task-modal-footer session-footer">
          <button className="session-pause" onClick={togglePause} disabled={!!submittingAction}>
            {pausedAtMs == null ? 'PAUSE' : 'RESUME'}
          </button>
          <SessionOutcomeForm
            submittingAction={submittingAction}
            error={settlementError}
            onSubmit={settleSession}
          />
        </div>
      </div>
    </div>
  );
}
