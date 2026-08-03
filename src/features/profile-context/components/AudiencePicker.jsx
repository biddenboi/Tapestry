import { CONTEXT_AUDIENCE } from '@domain/profile-context/Contracts.js';
import ProfilePicture from '@shared/profile-picture/ProfilePicture.jsx';

const OPTIONS = [
  [CONTEXT_AUDIENCE.private, 'Only me', 'Safe default; nothing appears in Social World.'],
  [CONTEXT_AUDIENCE.selected, 'Selected people', 'Only the named recipients can see it.'],
  [CONTEXT_AUDIENCE.collaborators, 'Collaborators', 'Accepted collaborators only.'],
  [CONTEXT_AUDIENCE.fellows, 'Fellows', 'Current Fellow relationships only.'],
  [CONTEXT_AUDIENCE.cast, 'My cast', 'Collaborators and current Fellows.'],
];

export default function AudiencePicker({ value, onChange, people = [], recipientIds = [], onRecipientsChange }) {
  const eligiblePeople = people.filter((person) => person.UUID || person.profileId);
  const eligibleIds = eligiblePeople.map((person) => String(person.UUID || person.profileId));
  return (
    <fieldset className="profile-context-audience">
      <legend>Who can see this?</legend>
      <div className="profile-context-choice-grid">
        {OPTIONS.map(([id, label, description]) => (
          <label key={id} className={value === id ? 'is-selected' : ''}>
            <input type="radio" name="profile-context-audience" value={id} checked={value === id} onChange={() => onChange(id)} />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
          </label>
        ))}
      </div>
      {value === CONTEXT_AUDIENCE.selected && (
        <section className="profile-context-recipient-picker" aria-label="Choose specific profiles">
          <header>
            <div>
              <strong>Choose profiles</strong>
              <small>{recipientIds.length ? `${recipientIds.length} selected` : 'No profiles selected'}</small>
            </div>
            {eligiblePeople.length > 0 && (
              <div>
                <button type="button" onClick={() => onRecipientsChange?.(eligibleIds)}>Select all</button>
                <button type="button" onClick={() => onRecipientsChange?.([])} disabled={!recipientIds.length}>Clear</button>
              </div>
            )}
          </header>
          <div className="profile-context-recipient-grid">
          {eligiblePeople.length ? eligiblePeople.map((person) => {
            const id = String(person.UUID || person.profileId || '');
            const checked = recipientIds.includes(id);
            const username = person.username || person.identity?.username || id;
            return (
              <label key={id} className={checked ? 'is-selected' : ''}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onRecipientsChange?.(
                    checked ? recipientIds.filter((entry) => entry !== id) : [...recipientIds, id],
                  )}
                />
                <ProfilePicture src={person.profilePicture} username={username} size={30} />
                <span>
                  <strong>{username}</strong>
                  <small>{person.headline || person.identity?.headline || 'Local profile'}</small>
                </span>
                <b aria-hidden="true">{checked ? '✓' : '+'}</b>
              </label>
            );
          }) : <p>No eligible people are loaded yet.</p>}
          </div>
        </section>
      )}
    </fieldset>
  );
}
