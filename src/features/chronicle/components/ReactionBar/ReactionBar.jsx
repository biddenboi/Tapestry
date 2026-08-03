const REACTIONS = [
  ['acknowledge', 'Acknowledge', 'Acknowledged'],
  ['celebrate', 'Celebrate', 'Celebrated'],
  ['support', 'Support', 'Supported'],
];

export default function ReactionBar({
  reactions = [],
  viewerUUID,
  enabled = true,
  onReact,
}) {
  if (!enabled) return <p className="chronicle-reactions-disabled">Reactions are closed.</p>;
  const active = reactions.find((reaction) => String(reaction.reactorUUID) === String(viewerUUID));
  const summary = REACTIONS.map(([type, , pastTense]) => {
    const names = reactions.filter((reaction) => reaction.type === type);
    return names.length ? `${pastTense} by ${names.length}` : null;
  }).filter(Boolean).join(' · ');
  return (
    <div className="chronicle-reactions" aria-label="Reactions">
      <div className="chronicle-reaction-actions">
        {REACTIONS.map(([type, label]) => (
          <button
            type="button"
            key={type}
            className={active?.type === type ? 'is-active' : ''}
            aria-pressed={active?.type === type}
            onClick={() => onReact?.(active?.type === type ? null : type)}
          >
            {label}
          </button>
        ))}
      </div>
      {summary && <p aria-live="polite">{summary}</p>}
    </div>
  );
}
