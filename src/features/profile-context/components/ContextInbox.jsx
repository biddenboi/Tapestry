import EvidencePanel from './EvidencePanel.jsx';

export default function ContextInbox({ suggestions = [], saving, onRefresh, onResolve }) {
  return (
    <section className="profile-context-inbox">
      <header>
        <div>
          <span>Context inbox</span>
          <p>Private drafts from deterministic facts. Nothing is shared until you approve it.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={saving}>Find suggestions</button>
      </header>
      {suggestions.length === 0 ? (
        <div className="profile-context-empty">No private suggestions waiting.</div>
      ) : suggestions.slice(0, 3).map((suggestion) => (
        <article key={suggestion.UUID}>
          <span>{suggestion.type}{suggestion.tentative ? ' · tentative' : ''}</span>
          <strong>{suggestion.text}</strong>
          <EvidencePanel suggestion={suggestion} />
          <div>
            <button type="button" className="primary" onClick={() => onResolve({ suggestionId: suggestion.UUID, resolution: 'accept' })} disabled={saving}>
              Approve privately
            </button>
            <button type="button" onClick={() => {
              const editedText = window.prompt('Edit before approving', suggestion.text);
              if (editedText?.trim()) onResolve({ suggestionId: suggestion.UUID, resolution: 'accept', editedText });
            }} disabled={saving}>Edit + approve</button>
            <button type="button" onClick={() => onResolve({ suggestionId: suggestion.UUID, resolution: 'dismiss' })} disabled={saving}>Dismiss</button>
          </div>
        </article>
      ))}
    </section>
  );
}

