import '@features/tasks/modals/SessionResults/SessionResults.css';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { showTaskCreationMenu } from '@features/tasks/modals/TaskCreationMenu/loadTaskCreationMenu.js';

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(Number(ms || 0) / 60000));
  if (totalMinutes < 1) return 'Less than a minute';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

const OUTCOME_COPY = {
  completed: ['Completed', 'The action was closed and its evidence was saved.'],
  progressed: ['Progressed', 'The action remains open with today’s effort attached.'],
  blocked: ['Blocked', 'The blocker and return context were preserved.'],
  stopped: ['Stopped', 'The session closed without claiming progress.'],
};

function IntegrationRow({ label, children }) {
  if (!children) return null;
  return (
    <div className="results-integration-row">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

export default NiceModal.create(({
  duration,
  points = 0,
  tokens = 0,
  taskName = '',
  outcome = 'progressed',
  nextStep = null,
  blockerType = null,
  integration = null,
  provenance = [],
  showTaskCreation = false,
  matchScoreBreakdown = null,
}) => {
  const modal = useModal();
  const [outcomeLabel, outcomeDescription] = OUTCOME_COPY[outcome] || OUTCOME_COPY.progressed;
  const close = () => {
    modal.hide();
    modal.remove();
    if (showTaskCreation) requestAnimationFrame(() => showTaskCreationMenu());
  };

  if (!modal.visible) return null;
  return (
    <div className="session-results">
      <div className="blanker" />
      <section className="results-card results-card--calm" role="dialog" aria-modal="true" aria-label="Session saved">
        <header className="results-header">
          <span className="results-eyebrow">CONTINUITY SAVED</span>
          <h1 className="results-title">{outcomeLabel}</h1>
          <p>{outcomeDescription}</p>
        </header>

        <div className="results-summary">
          <div>
            <span>Action</span>
            <strong>{taskName || 'Work session'}</strong>
          </div>
          <div>
            <span>Active time</span>
            <strong>{formatDuration(duration)}</strong>
          </div>
          <div>
            <span>Settled</span>
            <strong>{Math.floor(Number(points) || 0).toLocaleString()} points · {Math.floor(Number(tokens) || 0).toLocaleString()} coins</strong>
          </div>
        </div>

        {(nextStep || blockerType) && (
          <section className="results-return">
            <span>RETURN THREAD</span>
            {blockerType && <p>Blocker: {String(blockerType).replaceAll('-', ' ')}</p>}
            {nextStep && <strong>{nextStep}</strong>}
          </section>
        )}

        {matchScoreBreakdown && (
          <section className="results-match-score" aria-label="Match score result">
            <span>MATCH SCORE</span>
            <div className="results-match-score__formula">
              <strong>{Math.floor(Number(matchScoreBreakdown.points) || 0).toLocaleString()} Match points</strong>
            </div>
            <p>
              {Number(matchScoreBreakdown.promisedMs || 0) <= 0
                ? 'No duration promise was set. Match scoring modifiers remain concealed.'
                : matchScoreBreakdown.promiseMet
                ? 'Promise honored. Its duration bonus was applied to this Match only.'
                : 'Promise missed. Only its hidden duration bonus was removed.'}
            </p>
          </section>
        )}

        <section className="results-integration">
          <h2>Where this went</h2>
          <IntegrationRow label="Effort">
            {integration?.effort
              ? `${Math.round(integration.effort.activeDurationMs / 60000)}m accepted`
              : 'Session recorded'}
          </IntegrationRow>
          <IntegrationRow label="Goal">
            {integration?.goal?.summary || (integration?.goal === null ? 'No linked Goal' : null)}
          </IntegrationRow>
          <IntegrationRow label="Match">
            {integration?.match ? `+${Math.floor(Number(integration.match.points) || 0).toLocaleString()} audited points` : 'No active Match'}
          </IntegrationRow>
          <IntegrationRow label="History">{integration?.history || 'Saved to Daybook'}</IntegrationRow>
          <IntegrationRow label="World">
            {integration?.world
              ? `${String(integration.world.consequenceType || 'work trace').replaceAll('-', ' ')} receipt revealed`
              : 'No world consequence'}
          </IntegrationRow>
        </section>

        {!!provenance.length && (
          <details className="results-provenance">
            <summary>Why these rewards?</summary>
            {provenance.map((record) => (
              <p key={record.UUID}>
                <strong>{record.rewardType}: +{Number(record.amount).toLocaleString()}</strong>
                <span>{record.explanation}</span>
              </p>
            ))}
          </details>
        )}

        <footer className="results-footer">
          <button className="primary" onClick={close}>Return to the world</button>
        </footer>
      </section>
    </div>
  );
});
