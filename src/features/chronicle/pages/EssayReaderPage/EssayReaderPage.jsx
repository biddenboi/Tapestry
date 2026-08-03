import MarkdownEditor from '../../../../shared/markdown-editor/MarkdownEditor.jsx';
import ContextDrawer from '../../components/ContextDrawer/ContextDrawer.jsx';

export default function EssayReaderPage({ entry, owner = false, onClose }) {
  return (
    <article className="chronicle-reader chronicle-essay-reader">
      <header>
        <button type="button" onClick={onClose}>Back</button>
        <span className="chronicle-kicker">Essay</span>
        <h1>{entry.title}</h1>
        {entry.subtitle && <p>{entry.subtitle}</p>}
        <time dateTime={entry.occurrenceAt}>{new Date(entry.occurrenceAt).toLocaleDateString()}</time>
      </header>
      <MarkdownEditor value={entry.entry || ''} readOnly className="chronicle-reading-body" />
      <ContextDrawer snapshot={entry.contextSnapshot} owner={owner} />
    </article>
  );
}
