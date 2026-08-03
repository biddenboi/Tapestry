export default function EntryAccessBadge({ entry = null, access = entry?.access || entry } = {}) {
  const visibility = access?.visibility || entry?.visibility || 'private';
  const state = access?.collaborationState || entry?.collaborationState || 'local';
  const label = visibility === 'global'
    ? `Global · ${state === 'locked' ? 'Locked' : 'Anyone can edit'}`
    : visibility === 'fellows'
      ? 'Fellows · Owner edits'
      : 'Private';
  return (
    <span className={`chronicle-access-badge chronicle-access-badge--${visibility}`}>
      {label}
    </span>
  );
}

