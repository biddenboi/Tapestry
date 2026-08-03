import { useMemo, useState } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import ActionRow from '@shared/ui/ActionRow.jsx';
import FormField from '@shared/ui/FormField.jsx';
import ModalFrame from '@shared/ui/ModalFrame.jsx';
import '@features/reminders/modals/ReminderModal/ReminderModal.css';
import { deleteReminderCommand, saveReminderCommand } from '@domain/reminders/ReminderCommands.js';

function localDateValue(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localTimeValue(value) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return '09:00';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default NiceModal.create(({ reminder = null, initialDate = null, onSaved }) => {
  const modal = useModal();
  const { databaseConnection, currentPlayer, invalidateDomains } = useAppContext();
  const initialValue = reminder?.snoozedUntil || reminder?.remindAt || initialDate;
  const [title, setTitle] = useState(reminder?.title || '');
  const [body, setBody] = useState(reminder?.body || '');
  const [date, setDate] = useState(localDateValue(initialValue));
  const [time, setTime] = useState(localTimeValue(initialValue));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const remindAt = useMemo(() => {
    if (!date || !time) return null;
    const parsed = new Date(`${date}T${time}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }, [date, time]);

  const close = () => {
    modal.hide();
    modal.remove();
  };

  const save = async () => {
    if (!title.trim() || !remindAt) return;
    if (!currentPlayer?.UUID) {
      setError('Select or create a profile before adding a reminder.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const now = new Date().toISOString();
      const record = {
        ...(reminder || {}),
        UUID: reminder?.UUID || uuid(),
        parent: reminder?.parent || currentPlayer.UUID,
        title: title.trim(),
        body: body.trim(),
        remindAt,
        completedAt: reminder?.completedAt || null,
        dismissedAt: null,
        snoozedUntil: null,
        createdAt: reminder?.createdAt || now,
        inGameTimestamp: reminder?.inGameTimestamp ?? getCurrentIGT(currentPlayer),
        updatedAt: now,
      };
      await saveReminderCommand(databaseConnection, record);
      invalidateDomains(DOMAIN_INVALIDATION.reminderWrite);
      onSaved?.(record);
      close();
    } catch (saveError) {
      setError(saveError.message || 'The reminder could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!reminder?.UUID || saving) return;
    setSaving(true);
    await deleteReminderCommand(databaseConnection, reminder);
    invalidateDomains(DOMAIN_INVALIDATION.reminderWrite);
    onSaved?.(null);
    close();
  };

  if (!modal.visible) return null;

  return (
    <ModalFrame
      onClose={close}
      title={reminder ? 'Edit reminder' : 'New reminder'}
      subtitle="A wall-clock prompt for a specific future moment."
      eyebrow="Reminder"
      accent="var(--color-warning)"
      className="reminder-modal"
      footer={(
        <ActionRow>
          {reminder && <button type="button" className="danger" onClick={remove} disabled={saving}>Delete</button>}
          <button type="button" onClick={close}>Cancel</button>
          <button type="button" className="primary" onClick={save} disabled={saving || !title.trim() || !remindAt}>
            {saving ? 'Saving...' : 'Save reminder'}
          </button>
        </ActionRow>
      )}
    >
      <div className="reminder-modal-form">
        <FormField label="Title" required>
          <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus data-autofocus="true" maxLength={120} />
        </FormField>
        <FormField label="Note" hint="Optional context shown with the notification.">
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} />
        </FormField>
        <div className="reminder-modal-when">
          <FormField label="Date" required>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </FormField>
          <FormField label="Time" required>
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </FormField>
        </div>
        {error && <div className="reminder-modal-error">{error}</div>}
      </div>
    </ModalFrame>
  );
});
