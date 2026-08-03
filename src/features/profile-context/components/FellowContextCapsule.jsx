import '../profile-context.css';

export default function FellowContextCapsule({ projection, compact = false }) {
  const lines = projection?.capsule || [];
  if (!lines.length) {
    return <span className="fellow-context-capsule fellow-context-capsule--private">Working privately</span>;
  }
  return (
    <span className={`fellow-context-capsule ${compact ? 'is-compact' : ''}`} aria-label="Shared life context">
      {lines.slice(0, 3).map((item) => (
        <span key={item.id}>
          <b>{item.type}</b>
          <em>{item.text}</em>
        </span>
      ))}
    </span>
  );
}
