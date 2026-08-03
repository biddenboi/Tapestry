import { useEffect, useState } from 'react';
import MarkdownEditor from '../../../../shared/markdown-editor/MarkdownEditor.jsx';
import ContextDrawer from '../../components/ContextDrawer/ContextDrawer.jsx';

export default function StoryReaderPage({
  story,
  entries = [],
  initialJournalUUID = null,
  owner = false,
  onClose,
  onAddEntry,
  onRead,
}) {
  const initial = Math.max(0, entries.findIndex((entry) => entry.UUID === initialJournalUUID));
  const [index, setIndex] = useState(initial);
  const entry = entries[index] || null;

  useEffect(() => {
    if (entry) onRead?.(entry);
  }, [entry, onRead]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'ArrowLeft') setIndex((value) => Math.max(0, value - 1));
      if (event.key === 'ArrowRight') setIndex((value) => Math.min(entries.length - 1, value + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entries.length]);

  if (!story || !entry) return (
    <main className="chronicle-story-empty">
      <header>
        <button type="button" onClick={onClose}>← Stories</button>
        <span className="chronicle-kicker">{story?.status || 'ongoing'} story</span>
        <h1>{story?.title || 'Story'}</h1>
      </header>
      <section>
        <span aria-hidden="true">◇</span>
        <h2>{owner ? 'Begin this Story' : 'No visible Entries yet'}</h2>
        <p>{owner
          ? 'Stories become useful when they collect the moments, decisions, and reflections that belong together.'
          : 'The author has not shared an Entry in this Story. Check back after the next chapter is published.'}</p>
        <div>
          <button type="button" onClick={onClose}>Back to Stories</button>
          {owner && <button type="button" className="primary" onClick={onAddEntry}>Add first Entry</button>}
        </div>
      </section>
    </main>
  );

  return (
    <article className="chronicle-reader chronicle-story-reader">
      <header>
        <button type="button" onClick={onClose}>Story overview</button>
        <span className="chronicle-kicker">{story.status} story</span>
        <h1>{story.title}</h1>
        <p>{index + 1} of {entries.length}</p>
      </header>
      <section className="chronicle-story-reader__entry">
        <time dateTime={entry.occurrenceAt}>{new Date(entry.occurrenceAt).toLocaleDateString()}</time>
        <h2>{entry.title || `Part ${index + 1}`}</h2>
        <MarkdownEditor value={entry.entry || ''} readOnly className="chronicle-reading-body" />
        <ContextDrawer snapshot={entry.contextSnapshot} owner={owner} />
      </section>
      <nav aria-label="Story sequence">
        <button type="button" disabled={index === 0} onClick={() => setIndex((value) => value - 1)}>Previous</button>
        <button type="button" onClick={onClose}>Overview</button>
        <button type="button" disabled={index === entries.length - 1} onClick={() => setIndex((value) => value + 1)}>Next</button>
      </nav>
    </article>
  );
}
