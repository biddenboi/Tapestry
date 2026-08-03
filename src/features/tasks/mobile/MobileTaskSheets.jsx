import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { STORES } from '@domain/constants.js';
import { deleteTaskCommand } from '@domain/tasks/TaskCommands.js';
import { saveTaskDraftCommand } from '@domain/tasks/TaskDraftCommand.js';
import { formatTaskRecurrence } from '@domain/tasks/TaskRecurrence.js';
import { parseCombinedInput } from '@shared/nlp/NLP.js';
import { completeTodoNow } from '@features/tasks/domain/completeTodoNow.js';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';
import { simpleMobileFeedback, taskCompletionFeedback } from '@app/mobile/application/MobileFeedback.js';

const TASK_GOAL_INVALIDATION = Object.freeze([
  ...new Set([...DOMAIN_INVALIDATION.taskWrite, ...DOMAIN_INVALIDATION.goalLinkWrite]),
]);

function localDate(value) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localTime(value) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) return '23:59';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function dueForDate(dateKey, time = '23:59') {
  const parsed = new Date(`${dateKey}T${time}`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function taskTiming(task) {
  const due = task?.dueDate ? new Date(task.dueDate) : null;
  const dueLabel = due && Number.isFinite(due.getTime())
    ? due.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'No due date';
  return `${dueLabel} · ${Number(task?.estimatedDuration || 30)} min`;
}

export function startTaskFromMobile(setActiveTask, task, reason = 'Started from mobile Today') {
  const requestedAt = new Date().toISOString();
  setActiveTask({
    ...task,
    todoCreatedAt: task.createdAt || null,
    createdAt: requestedAt,
    sessionRequestedAt: requestedAt,
    originalDuration: Number(task.estimatedDuration || 0),
    reasonToSelect: task.reasonToSelect || reason,
  });
}

export function MobileDatePickerSheet({ payload }) {
  const { closeSurface } = useMobileSurface();
  const [value, setValue] = useState(payload.selectedDate);
  return (
    <div className="mobile-sheet mobile-sheet--compact" role="dialog" aria-modal="true" aria-labelledby="mobile-date-sheet-title">
      <header><div><span>Date</span><h2 id="mobile-date-sheet-title">Choose a day</h2></div><button type="button" onClick={() => closeSurface()}>Close</button></header>
      <label className="mobile-field"><span>Date</span><input type="date" value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <div className="mobile-sheet-actions">
        <button type="button" onClick={() => setValue(localDate())}>Today</button>
        <button type="button" className="primary" onClick={() => { payload.onSelect(value); closeSurface({ force: true }); }}>Select</button>
      </div>
    </div>
  );
}

export function MobileTaskActionSheet({ payload }) {
  const { task, onChanged } = payload;
  const {
    databaseConnection,
    currentPlayer,
    invalidateDomains,
    notify,
    emitRewardEvent,
    gameState: [gameState],
    dojoSessionUUID,
    activeTask: [, setActiveTask],
  } = useAppContext();
  const { closeSurface, openSurface, presentFeedback } = useMobileSurface();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const complete = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await completeTodoNow({
        databaseConnection,
        todo: task,
        player: currentPlayer,
        gameState,
        dojoSessionUUID,
        notify,
        emitRewardEvent,
        source: 'mobile-task-action',
        origin: 'mobile',
      });
      invalidateDomains(DOMAIN_INVALIDATION.taskWrite);
      presentFeedback(taskCompletionFeedback(task, result));
      await onChanged?.();
      closeSurface({ force: true });
    } catch (completionError) {
      setError(completionError?.message || 'The task could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete “${task.name || 'this task'}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteTaskCommand(databaseConnection, task, { origin: 'mobile' });
      invalidateDomains(DOMAIN_INVALIDATION.taskWrite);
      await onChanged?.();
      closeSurface({ force: true });
    } catch (deleteError) {
      setError(deleteError?.message || 'The task could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mobile-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-task-actions-title">
      <header><div><span>Task</span><h2 id="mobile-task-actions-title">{task.name || 'Untitled task'}</h2><small>{taskTiming(task)}</small></div><button type="button" onClick={() => closeSurface()}>Close</button></header>
      {task.projectName && <p className="mobile-sheet-context">{task.projectName}</p>}
      <div className="mobile-sheet-primary-grid">
        <button type="button" className="primary" onClick={() => { startTaskFromMobile(setActiveTask, task); closeSurface({ force: true }); }}>Start</button>
        <button type="button" onClick={complete} disabled={busy}>Complete</button>
      </div>
      <div className="mobile-sheet-menu">
        <button type="button" onClick={() => openSurface('task-composer', { task, onSaved: onChanged })}>Edit task <span>›</span></button>
        <button type="button" onClick={() => openSurface('task-composer', { task, onSaved: onChanged, focusDate: true })}>Move to another day <span>›</span></button>
        <button type="button" className="danger" onClick={remove} disabled={busy}>Delete…</button>
      </div>
      {error && <div className="mobile-sheet-error" role="alert">{error}</div>}
    </div>
  );
}

export function MobileSystemDirectionSheet({ payload }) {
  const { activeTask: [, setActiveTask] } = useAppContext();
  const { closeSurface } = useMobileSurface();
  const { task, reason, onChooseAnother } = payload;
  return (
    <div className="mobile-sheet mobile-system-direction" role="dialog" aria-modal="true" aria-labelledby="mobile-direction-title">
      <header><div><span>System direction</span><h2 id="mobile-direction-title">{task.name}</h2><small>{taskTiming(task)}</small></div><button type="button" onClick={() => closeSurface()}>Close</button></header>
      <p><b>Reason:</b> {reason || task.reasonToSelect || 'This is the strongest available next action.'}</p>
      <div className="mobile-sheet-actions">
        <button type="button" onClick={() => { closeSurface({ force: true }); onChooseAnother?.(); }}>Choose another</button>
        <button type="button" className="primary" onClick={() => { startTaskFromMobile(setActiveTask, task, 'Accepted system direction'); closeSurface({ force: true }); }}>Start</button>
      </div>
    </div>
  );
}

export function MobileTaskComposer({ payload }) {
  const { databaseConnection, currentPlayer, invalidateDomains } = useAppContext();
  const { closeSurface, registerDismissGuard, presentFeedback } = useMobileSurface();
  const task = payload.task || {};
  const editing = Boolean(task.UUID);
  const initialDue = task.dueDate || dueForDate(payload.selectedDate || localDate());
  const [combined, setCombined] = useState(task.name || '');
  const [date, setDate] = useState(localDate(initialDue));
  const [time, setTime] = useState(localTime(initialDue));
  const [duration, setDuration] = useState(String(task.estimatedDuration || 30));
  const [projectId, setProjectId] = useState(task.projectId || '');
  const [description, setDescription] = useState(task.description || task.efficiency || '');
  const [aversion, setAversion] = useState(Number(task.aversion || 1));
  const [needsPlanning, setNeedsPlanning] = useState(Boolean(task.needsPlanning));
  const [recurrence, setRecurrence] = useState(task.recurrence?.frequency || task.repeatRule?.frequency || '');
  const [more, setMore] = useState(Boolean(payload.focusDate));
  const [dateExplicit, setDateExplicit] = useState(Boolean(editing));
  const [durationExplicit, setDurationExplicit] = useState(Boolean(editing));
  const [projects, setProjects] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const parsed = useMemo(() => parseCombinedInput(combined), [combined]);

  useEffect(() => {
    databaseConnection.getAll(STORES.project).then((rows) => setProjects(rows.filter((goal) => (
      goal.lifecycleStatus === 'active' || goal.status === 'active' || (!goal.lifecycleStatus && !goal.archivedAt)
    )))).catch(() => setProjects([]));
  }, [databaseConnection]);

  useEffect(() => registerDismissGuard(() => (
    !dirty || window.confirm('Discard the unsaved task changes?')
  )), [dirty, registerDismissGuard]);

  useEffect(() => {
    if (dateExplicit || !parsed.dueDate.iso) return;
    setDate(localDate(parsed.dueDate.iso));
    setTime(localTime(parsed.dueDate.iso));
  }, [dateExplicit, parsed.dueDate.iso]);

  useEffect(() => {
    if (durationExplicit || !parsed.duration.minutes) return;
    setDuration(String(parsed.duration.minutes));
  }, [durationExplicit, parsed.duration.minutes]);

  const markDirty = () => setDirty(true);
  const title = String(parsed.name || combined).trim();
  const dueDate = dueForDate(date, time);

  const save = async (event) => {
    event.preventDefault();
    if (!title || !dueDate || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await saveTaskDraftCommand(databaseConnection, {
        taskDraft: task,
        player: currentPlayer,
        fields: {
          name: title,
          dueDate,
          estimatedDuration: Number(duration) || 30,
          projectId: projectId || null,
          recurrence: recurrence ? { frequency: recurrence, interval: 1 } : null,
          description,
          aversion,
          needsPlanning,
        },
      }, { origin: 'mobile' });
      invalidateDomains(TASK_GOAL_INVALIDATION);
      presentFeedback(simpleMobileFeedback('task-saved', editing ? 'Task updated' : 'Task added', {
        sourceId: result.task.UUID,
      }));
      await payload.onSaved?.(result.task);
      closeSurface({ force: true });
    } catch (saveError) {
      setError(saveError?.message || 'The task could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing || !window.confirm(`Delete “${task.name || 'this task'}”? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await deleteTaskCommand(databaseConnection, task, { origin: 'mobile' });
      invalidateDomains(DOMAIN_INVALIDATION.taskWrite);
      await payload.onSaved?.(null);
      closeSurface({ force: true });
    } catch (deleteError) {
      setError(deleteError?.message || 'The task could not be deleted.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="mobile-sheet mobile-sheet--editor" role="dialog" aria-modal="true" aria-labelledby="mobile-task-editor-title" onSubmit={save}>
      <header><button type="button" onClick={() => closeSurface()}>Cancel</button><h2 id="mobile-task-editor-title">{editing ? 'Edit task' : 'New task'}</h2><button type="submit" className="primary" disabled={saving || !title || !dueDate}>{saving ? 'Saving…' : editing ? 'Save' : 'Add task'}</button></header>
      <div className="mobile-sheet-scroll">
        <label className="mobile-field mobile-field--hero"><span>What needs to be done?</span><input value={combined} onChange={(event) => { setCombined(event.target.value); markDirty(); }} autoFocus={!editing} data-autofocus={!editing ? 'true' : undefined} placeholder="Finish physics tomorrow at 5" /></label>
        <div className="mobile-composer-chips">
          <label><span>Date</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setDateExplicit(true); markDirty(); }} /></label>
          <label><span>Time</span><input type="time" value={time} onChange={(event) => { setTime(event.target.value); setDateExplicit(true); markDirty(); }} /></label>
          <label><span>Duration (minutes)</span><input type="number" min="1" max="1440" step="1" inputMode="numeric" value={duration} onChange={(event) => { setDuration(event.target.value); setDurationExplicit(true); markDirty(); }} /></label>
          <label><span>Goal</span><select value={projectId} onChange={(event) => { setProjectId(event.target.value); markDirty(); }}><option value="">No goal</option>{projects.map((goal) => <option key={goal.UUID} value={goal.UUID}>{goal.name}</option>)}</select></label>
        </div>
        {(parsed.dueDate.display || parsed.duration.display) && <p className="mobile-parser-confirmation">Understood: {[parsed.dueDate.display, parsed.duration.display].filter(Boolean).join(' · ')}. Chips override this text.</p>}
        <button type="button" className="mobile-disclosure" aria-expanded={more} onClick={() => setMore((value) => !value)}>More options <span>{more ? '−' : '+'}</span></button>
        {more && (
          <div className="mobile-composer-more">
            <label className="mobile-field"><span>Recurrence</span><select value={recurrence} onChange={(event) => { setRecurrence(event.target.value); markDirty(); }}><option value="">Does not repeat</option><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select></label>
            <label className="mobile-field"><span>Resistance</span><select value={aversion} onChange={(event) => { setAversion(Number(event.target.value)); markDirty(); }}><option value="1">Low</option><option value="2">Medium</option><option value="3">High</option></select></label>
            <label className="mobile-field"><span>Description or plan</span><textarea value={description} onChange={(event) => { setDescription(event.target.value); markDirty(); }} rows={4} /></label>
            <label className="mobile-check-row"><input type="checkbox" checked={needsPlanning} onChange={(event) => { setNeedsPlanning(event.target.checked); markDirty(); }} /><span>Needs planning before starting</span></label>
          </div>
        )}
        {editing && <button type="button" className="mobile-editor-delete danger" onClick={remove} disabled={saving}>Delete task…</button>}
        {task.recurrence && <small className="mobile-current-recurrence">Current: {formatTaskRecurrence(task.recurrence)}</small>}
        {error && <div className="mobile-sheet-error" role="alert">{error}</div>}
      </div>
      <footer><button type="submit" className="primary" disabled={saving || !title || !dueDate}>{saving ? 'Saving…' : editing ? 'Save task' : 'Add task'}</button></footer>
    </form>
  );
}
