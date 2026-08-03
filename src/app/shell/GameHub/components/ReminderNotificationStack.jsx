import { useState } from 'react';
import { explainNotificationDecision } from '@domain/notifications/NotificationPolicy.js';

function formatReminderToastTime(reminder) {
  const raw = reminder?.snoozedUntil || reminder?.remindAt;
  const due = raw ? new Date(raw) : null;
  if (!due || Number.isNaN(due.getTime())) return 'Due now';
  return due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function ReminderNotificationStack({ reminders, onOpen, onDismiss }) {
  const [whyId, setWhyId] = useState(null);
  if (!reminders?.length) return null;
  return (
    <div className="hub-reminder-stack" aria-live="polite" aria-label="Due reminders">
      {reminders.map((reminder) => (
        <article key={reminder.UUID} className="hub-reminder-toast">
          <span className="hub-reminder-toast__icon" aria-hidden="true">!</span>
          <button
            type="button"
            className="hub-reminder-toast__body"
            onClick={() => onOpen(reminder)}
          >
            <span>{formatReminderToastTime(reminder)}</span>
            <strong>{reminder.title || 'Reminder'}</strong>
            {reminder.body && <small>{reminder.body}</small>}
          </button>
          <button
            type="button"
            className="hub-reminder-toast__dismiss"
            onClick={() => onDismiss(reminder)}
            aria-label="Dismiss reminder"
          >
            x
          </button>
          <button
            type="button"
            className="hub-reminder-toast__why"
            onClick={() => setWhyId((current) => current === reminder.UUID ? null : reminder.UUID)}
            aria-expanded={whyId === reminder.UUID}
          >
            Why?
          </button>
          {whyId === reminder.UUID && (
            <p className="hub-reminder-toast__reason">
              {explainNotificationDecision(reminder.interventionDecision)}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
