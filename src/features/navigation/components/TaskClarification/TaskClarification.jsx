import { useState } from 'react';
import { STORES } from '../../../../domain/constants.js';
import {
  createTaskPlanReceipt,
  hashTaskRevision,
} from '../../../../domain/planning/TaskPlanReceipt.js';

export default function TaskClarification({
  databaseConnection,
  playerUUID,
  task,
  onCancel,
  onSaved,
}) {
  const [nextAction, setNextAction] = useState(task?.nextAction || '');
  const [showOptional, setShowOptional] = useState(false);
  const [estimatedMinutes, setEstimatedMinutes] = useState(task?.estimatedDuration || '');
  const [opportunity, setOpportunity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!String(nextAction).trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const now = new Date().toISOString();
      const nextTask = {
        ...task,
        description: task.description ?? task.efficiency ?? '',
        nextAction: String(nextAction).trim(),
        needsPlanning: false,
        planEligible: true,
        blockerType: null,
        status: task.status === 'blocked' ? 'active' : task.status,
        clarificationFailures: 0,
        updatedAt: now,
      };
      nextTask.taskRevisionHash = hashTaskRevision(nextTask);
      const receipt = createTaskPlanReceipt({
        playerUUID,
        task: nextTask,
        nextAction,
        estimatedRemainingMinutes: estimatedMinutes,
        intendedOpportunity: opportunity.trim()
          ? { triggerType: 'manual', triggerValue: opportunity.trim() }
          : null,
        createdAt: now,
      });
      if (typeof databaseConnection.commitAtomicMutation === 'function') {
        await databaseConnection.commitAtomicMutation({
          label: `task-clarification:${task.UUID}`,
          puts: [
            { store: STORES.todo, record: nextTask },
            { store: STORES.taskPlanReceipt, record: receipt },
          ],
        });
      } else {
        await databaseConnection.add(STORES.todo, nextTask);
        await databaseConnection.add(STORES.taskPlanReceipt, receipt);
      }
      onSaved?.({ task: nextTask, receipt });
    } catch (nextError) {
      setError(nextError.message || 'The next action could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="next-move-clarification" aria-labelledby="next-move-clarify-title">
      <span className="next-move-kicker">Bounded clarification</span>
      <h2 id="next-move-clarify-title">Define the first visible action</h2>
      <p>What can create visible progress in the next 10 minutes?</p>
      <label>
        Next action
        <input
          autoFocus
          value={nextAction}
          maxLength={500}
          onChange={(event) => setNextAction(event.target.value)}
          placeholder="Open the outline and draft the first paragraph"
        />
      </label>
      <button
        type="button"
        className="next-move-text-button"
        onClick={() => setShowOptional((visible) => !visible)}
        aria-expanded={showOptional}
      >
        {showOptional ? 'Hide optional details' : 'Add optional details'}
      </button>
      {showOptional && (
        <div className="next-move-clarification__optional">
          <label>
            Remaining estimate
            <input
              type="number"
              min="0"
              value={estimatedMinutes}
              onChange={(event) => setEstimatedMinutes(event.target.value)}
              placeholder="Minutes"
            />
          </label>
          <label>
            Intended opportunity
            <input
              value={opportunity}
              maxLength={500}
              onChange={(event) => setOpportunity(event.target.value)}
              placeholder="After dinner, at my desk"
            />
          </label>
        </div>
      )}
      {error && <p className="next-move-error" role="alert">{error}</p>}
      <footer>
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          type="button"
          className="primary"
          onClick={save}
          disabled={busy || !String(nextAction).trim()}
        >
          {busy ? 'Saving…' : 'Save and begin'}
        </button>
      </footer>
    </section>
  );
}
