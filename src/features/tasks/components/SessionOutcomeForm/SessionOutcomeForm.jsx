import { useState } from 'react';
import {
  ACTION_SESSION_BLOCKER,
  ACTION_SESSION_OUTCOME,
} from '@domain/continuity/ActionSession.js';
import './SessionOutcomeForm.css';

const OUTCOMES = [
  {
    id: ACTION_SESSION_OUTCOME.completed,
    label: 'Completed',
    hint: 'The action is done.',
  },
  {
    id: ACTION_SESSION_OUTCOME.progressed,
    label: 'Progressed',
    hint: 'Useful work happened; keep the action.',
  },
  {
    id: ACTION_SESSION_OUTCOME.blocked,
    label: 'Blocked',
    hint: 'Save what is preventing the next move.',
  },
  {
    id: ACTION_SESSION_OUTCOME.stopped,
    label: 'Stopped',
    hint: 'Close cleanly without claiming progress.',
  },
];

const BLOCKERS = [
  [ACTION_SESSION_BLOCKER.person, 'Waiting on a person'],
  [ACTION_SESSION_BLOCKER.information, 'Missing information'],
  [ACTION_SESSION_BLOCKER.technical, 'Technical problem'],
  [ACTION_SESSION_BLOCKER.unclear, 'Next step unclear'],
  [ACTION_SESSION_BLOCKER.environment, 'Environment unavailable'],
  [ACTION_SESSION_BLOCKER.irrelevant, 'No longer relevant'],
  [ACTION_SESSION_BLOCKER.other, 'Other'],
];

export default function SessionOutcomeForm({
  compact = false,
  submittingAction = null,
  error = '',
  onCancel,
  onSubmit,
}) {
  const [outcome, setOutcome] = useState(null);
  const [blockerType, setBlockerType] = useState(ACTION_SESSION_BLOCKER.other);
  const [nextStep, setNextStep] = useState('');
  const [outcomeNote, setOutcomeNote] = useState('');
  const busy = !!submittingAction;

  if (!outcome) {
    return (
      <div className={`session-outcome ${compact ? 'session-outcome--compact' : ''}`}>
        <span className="session-outcome__label">How did this session end?</span>
        <div className="session-outcome__choices">
          {OUTCOMES.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => setOutcome(item.id)}
              disabled={busy}
              title={item.hint}
            >
              {item.label}
            </button>
          ))}
        </div>
        {error && <p className="session-outcome__error" role="alert">{error}</p>}
      </div>
    );
  }

  const definition = OUTCOMES.find((item) => item.id === outcome);
  return (
    <div className={`session-outcome session-outcome--details ${compact ? 'session-outcome--compact' : ''}`}>
      <header>
        <button type="button" onClick={() => setOutcome(null)} disabled={busy}>← Outcomes</button>
        <strong>{definition.label}</strong>
      </header>
      <p>{definition.hint}</p>
      {outcome === ACTION_SESSION_OUTCOME.blocked && (
        <label>
          Blocker
          <select value={blockerType} onChange={(event) => setBlockerType(event.target.value)}>
            {BLOCKERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      )}
      {[ACTION_SESSION_OUTCOME.progressed, ACTION_SESSION_OUTCOME.blocked].includes(outcome) && (
        <label>
          Next visible step <span>optional</span>
          <input
            value={nextStep}
            maxLength={500}
            onChange={(event) => setNextStep(event.target.value)}
            placeholder="What would make returning easy?"
          />
        </label>
      )}
      {outcome !== ACTION_SESSION_OUTCOME.completed && (
        <label>
          {outcome === ACTION_SESSION_OUTCOME.blocked ? 'Context to preserve' : 'Session note'} <span>optional</span>
          <textarea
            value={outcomeNote}
            maxLength={1200}
            rows={compact ? 2 : 3}
            onChange={(event) => setOutcomeNote(event.target.value)}
            placeholder="A short note for your future self"
          />
        </label>
      )}
      {error && <p className="session-outcome__error" role="alert">{error}</p>}
      <footer>
        {onCancel && <button type="button" onClick={onCancel} disabled={busy}>Keep working</button>}
        <button
          type="button"
          className="primary"
          onClick={() => onSubmit?.({ outcome, blockerType, nextStep, outcomeNote })}
          disabled={busy}
        >
          {busy ? 'Saving…' : `Save as ${definition.label.toLowerCase()}`}
        </button>
      </footer>
    </div>
  );
}
