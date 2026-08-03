import { projectChronicleContext } from '../../../../domain/chronicle/ChronicleContextSnapshot.js';

function rows(value = {}) {
  return Object.entries(value).filter(([, item]) => item != null && item !== '');
}

export default function ContextDrawer({ snapshot, owner = false }) {
  const context = projectChronicleContext(snapshot, { owner });
  const shared = rows(context.shared);
  const privateRows = owner ? rows(context.private) : [];
  if (!shared.length && !privateRows.length) return null;
  return (
    <details className="chronicle-context-drawer">
      <summary>At this point</summary>
      {shared.length > 0 && (
        <section>
          <h4>Saved with this entry</h4>
          <dl>{shared.map(([key, value]) => (
            <div key={key}><dt>{key}</dt><dd>{typeof value === 'object' ? value.label || value.UUID : String(value)}</dd></div>
          ))}</dl>
        </section>
      )}
      {privateRows.length > 0 && (
        <section>
          <h4>Private context · only you can see this</h4>
          <dl>{privateRows.map(([key, value]) => (
            <div key={key}><dt>{key}</dt><dd>{typeof value === 'object' ? value.label || value.UUID : String(value)}</dd></div>
          ))}</dl>
        </section>
      )}
    </details>
  );
}
