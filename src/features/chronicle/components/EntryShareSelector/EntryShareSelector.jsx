const OPTIONS = Object.freeze([
  ['private', 'Private', 'Only you can read and edit'],
  ['fellows', 'Fellows', 'Fellows can read; only you can edit'],
  ['global', 'Global', 'Every local profile can read and edit; full history is saved'],
]);

export default function EntryShareSelector({ value, onChange, disabled = false }) {
  return (
    <fieldset className="chronicle-share-selector">
      <legend>Who can access this?</legend>
      {OPTIONS.map(([option, label, copy]) => (
          <label key={option}>
            <input
              type="radio"
              name="chronicle-entry-access"
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              disabled={disabled}
            />
            <span><strong>{label}</strong><small>{copy}</small></span>
          </label>
      ))}
    </fieldset>
  );
}
