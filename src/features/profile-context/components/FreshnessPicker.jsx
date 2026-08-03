const OPTIONS = [
  ['24', '24 hours'],
  ['72', '3 days'],
  ['168', '1 week'],
  ['720', '30 days'],
];

export function expiryFromHours(hours) {
  return new Date(Date.now() + (Number(hours || 72) * 60 * 60 * 1000)).toISOString();
}

export default function FreshnessPicker({ value, onChange }) {
  return (
    <label className="profile-context-freshness">
      <span>Disappear after</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {OPTIONS.map(([hours, label]) => <option key={hours} value={hours}>{label}</option>)}
      </select>
      <small>Expired context quietly stops projecting everywhere.</small>
    </label>
  );
}

