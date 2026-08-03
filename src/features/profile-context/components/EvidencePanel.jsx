export default function EvidencePanel({ suggestion }) {
  if (!suggestion) return null;
  return (
    <details className="profile-context-evidence">
      <summary>Why this suggestion?</summary>
      <p>{suggestion.reason}</p>
      <small>{suggestion.evidence?.length || 0} source record{suggestion.evidence?.length === 1 ? '' : 's'} · titles remain private</small>
    </details>
  );
}

