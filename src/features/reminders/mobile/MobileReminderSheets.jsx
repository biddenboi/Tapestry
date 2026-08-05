import { useEffect, useMemo, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import {
  deleteReminderCommand,
  saveReminderCommand,
  transitionReminderCommand,
} from '@domain/reminders/ReminderCommands.js';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';
import { simpleMobileFeedback } from '@app/mobile/application/MobileFeedback.js';
import { requestPromptReferenceSync } from '@data/sync/ReferenceSyncLanes.js';
import { parseCombinedInput } from '@shared/nlp/NLP.js';
import { reminderPresetTime, resolveReminderSnooze } from './MobileReminderTime.js';

function validDate(value, fallback = new Date()) {
  const parsed = new Date(value || fallback);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(fallback);
}

function localDate(value) {
  const date = validDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localTime(value) {
  const date = validDate(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function fromLocal(date, time) {
  const parsed = new Date(`${date}T${time}`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function reminderWhen(reminder) {
  return validDate(reminder.snoozedUntil || reminder.remindAt).toLocaleString([], {
    weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function MobileReminderActionSheet({ payload }) {
  const { reminder, onChanged } = payload;
  const { databaseConnection, invalidateDomains } = useAppContext();
  const { closeSurface, openSurface, presentFeedback } = useMobileSurface();
  const [showSnooze, setShowSnooze] = useState(false);
  const [customAt, setCustomAt] = useState(localDate(new Date(Date.now() + 2 * 60 * 60_000)) + 'T' + localTime(new Date(Date.now() + 2 * 60 * 60_000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const changed = async () => {
    invalidateDomains(DOMAIN_INVALIDATION.reminderWrite);
    await onChanged?.();
  };

  const complete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await databaseConnection.completeReminder(reminder.UUID, { origin: 'mobile' });
      await changed();
      presentFeedback(simpleMobileFeedback('reminder-completed', `${reminder.title || 'Reminder'} done`, { sourceId: reminder.UUID }));
      closeSurface({ force: true });
    } catch (completionError) {
      setError(completionError?.message || 'The reminder could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const snooze = async (choice) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const snoozedUntil = resolveReminderSnooze(choice, { customAt });
      await transitionReminderCommand(databaseConnection, reminder, 'snoozeReminder', {
        snoozedUntil,
        dismissedAt: null,
      }, { origin: 'mobile' });
      await changed();
      presentFeedback(simpleMobileFeedback('reminder-snoozed', `Snoozed until ${validDate(snoozedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, { sourceId: reminder.UUID }));
      closeSurface({ force: true });
    } catch (snoozeError) {
      setError(snoozeError?.message || 'The reminder could not be snoozed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mobile-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-reminder-actions-title">
      <header><div><span>Reminder</span><h2 id="mobile-reminder-actions-title">{reminder.title || 'Reminder'}</h2><small>{reminderWhen(reminder)}</small></div><button type="button" onClick={() => closeSurface()}>Close</button></header>
      {reminder.body && <p className="mobile-sheet-context">{reminder.body}</p>}
      <div className="mobile-sheet-primary-grid mobile-sheet-primary-grid--three">
        <button type="button" className="primary" onClick={complete} disabled={busy}>Done</button>
        <button type="button" onClick={() => setShowSnooze((value) => !value)} aria-expanded={showSnooze}>Snooze</button>
        <button type="button" onClick={() => openSurface('reminder-composer', { reminder, onSaved: onChanged })}>Edit</button>
      </div>
      {showSnooze && (
        <div className="mobile-snooze-grid">
          <button type="button" onClick={() => snooze('10m')}>10 minutes</button>
          <button type="button" onClick={() => snooze('30m')}>30 minutes</button>
          <button type="button" onClick={() => snooze('1h')}>1 hour</button>
          <button type="button" onClick={() => snooze('tomorrow')}>Tomorrow</button>
          <label><span>Choose…</span><input type="datetime-local" value={customAt} onChange={(event) => setCustomAt(event.target.value)} /></label>
          <button type="button" onClick={() => snooze('custom')} disabled={!customAt}>Snooze until chosen time</button>
        </div>
      )}
      {error && <div className="mobile-sheet-error" role="alert">{error}</div>}
    </div>
  );
}

export function MobileReminderComposer({ payload }) {
  const { databaseConnection, currentPlayer, invalidateDomains } = useAppContext();
  const { closeSurface, registerDismissGuard, presentFeedback } = useMobileSurface();
  const reminder = payload.reminder || {};
  const editing = Boolean(reminder.UUID);
  const initialAt = reminder.snoozedUntil || reminder.remindAt || reminderPresetTime('1h');
  const [title, setTitle] = useState(reminder.title || '');
  const [body, setBody] = useState(reminder.body || '');
  const [date, setDate] = useState(localDate(initialAt));
  const [time, setTime] = useState(localTime(initialAt));
  const [showNote, setShowNote] = useState(Boolean(reminder.body));
  const [dateExplicit, setDateExplicit] = useState(editing);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const remindAt = useMemo(() => fromLocal(date, time), [date, time]);
  const parsed = useMemo(() => parseCombinedInput(title, { excludeDuration: true }), [title]);
  const cleanTitle = String(parsed.name || title).trim();

  useEffect(() => {
    if (dateExplicit || !parsed.dueDate.iso) return;
    setDate(localDate(parsed.dueDate.iso));
    setTime(localTime(parsed.dueDate.iso));
  }, [dateExplicit, parsed.dueDate.iso]);

  useEffect(() => registerDismissGuard(() => (
    !dirty || window.confirm('Discard the unsaved reminder changes?')
  )), [dirty, registerDismissGuard]);

  const choosePreset = (preset) => {
    const next = reminderPresetTime(preset);
    setDate(localDate(next));
    setTime(localTime(next));
    setDateExplicit(true);
    setDirty(true);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!cleanTitle || !remindAt || saving) return;
    setSaving(true);
    setError('');
    try {
      const now = new Date().toISOString();
      const record = {
        ...reminder,
        UUID: reminder.UUID || uuid(),
        parent: reminder.parent || currentPlayer.UUID,
        title: cleanTitle,
        body: body.trim(),
        remindAt,
        completedAt: reminder.completedAt || null,
        dismissedAt: null,
        snoozedUntil: null,
        createdAt: reminder.createdAt || now,
        inGameTimestamp: reminder.inGameTimestamp ?? getCurrentIGT(currentPlayer),
      };
      const result = await saveReminderCommand(databaseConnection, record, { origin: 'mobile' });
      invalidateDomains(DOMAIN_INVALIDATION.reminderWrite);
      void requestPromptReferenceSync(databaseConnection, 'mobile-reminder-save');
      await payload.onSaved?.(result.reminder);
      const scheduledLabel = validDate(remindAt).toLocaleString([], {
        weekday: 'short', hour: 'numeric', minute: '2-digit',
      });
      presentFeedback(simpleMobileFeedback('reminder-scheduled', `Reminder scheduled · ${scheduledLabel}`, {
        significance: 'meaningful',
        sourceId: result.reminder.UUID,
      }));
      closeSurface({ force: true });
    } catch (saveError) {
      setError(saveError?.message || 'The reminder could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing || !window.confirm(`Delete “${reminder.title || 'this reminder'}”?`)) return;
    setSaving(true);
    try {
      await deleteReminderCommand(databaseConnection, reminder, { origin: 'mobile' });
      invalidateDomains(DOMAIN_INVALIDATION.reminderWrite);
      await payload.onSaved?.(null);
      closeSurface({ force: true });
    } catch (deleteError) {
      setError(deleteError?.message || 'The reminder could not be deleted.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="mobile-sheet mobile-sheet--editor" role="dialog" aria-modal="true" aria-labelledby="mobile-reminder-editor-title" onSubmit={save}>
      <header><button type="button" onClick={() => closeSurface()}>Cancel</button><h2 id="mobile-reminder-editor-title">{editing ? 'Edit reminder' : 'New reminder'}</h2><button type="submit" className="primary" disabled={saving || !cleanTitle || !remindAt}>{saving ? 'Saving…' : editing ? 'Save' : 'Create'}</button></header>
      <div className="mobile-sheet-scroll">
        <label className="mobile-field mobile-field--hero"><span>Reminder</span><input value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true); }} autoFocus={!editing} data-autofocus={!editing ? 'true' : undefined} maxLength={160} placeholder="Call Alex tomorrow at 9" /></label>
        <section className="mobile-preset-section"><h3>When</h3><div className="mobile-preset-grid"><button type="button" onClick={() => choosePreset('30m')}>In 30m</button><button type="button" onClick={() => choosePreset('1h')}>In 1h</button><button type="button" onClick={() => choosePreset('evening')}>This evening</button><button type="button" onClick={() => choosePreset('tomorrow')}>Tomorrow morning</button></div></section>
        <div className="mobile-composer-chips mobile-composer-chips--two"><label><span>Date</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setDateExplicit(true); setDirty(true); }} /></label><label><span>Time</span><input type="time" value={time} onChange={(event) => { setTime(event.target.value); setDateExplicit(true); setDirty(true); }} /></label></div>
        <p className="mobile-parser-confirmation">{parsed.dueDate.iso ? `Understood “${cleanTitle}” · ` : ''}Scheduled for {remindAt ? validDate(remindAt).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'an invalid time'}.</p>
        <button type="button" className="mobile-disclosure" aria-expanded={showNote} onClick={() => setShowNote((value) => !value)}>Add note <span>{showNote ? '−' : '+'}</span></button>
        {showNote && <label className="mobile-field"><span>Note</span><textarea value={body} onChange={(event) => { setBody(event.target.value); setDirty(true); }} rows={5} /></label>}
        {editing && <button type="button" className="mobile-editor-delete danger" onClick={remove} disabled={saving}>Delete reminder…</button>}
        {error && <div className="mobile-sheet-error" role="alert">{error}</div>}
      </div>
      <footer><button type="submit" className="primary" disabled={saving || !cleanTitle || !remindAt}>{saving ? 'Saving…' : editing ? 'Save reminder' : 'Create reminder'}</button></footer>
    </form>
  );
}
