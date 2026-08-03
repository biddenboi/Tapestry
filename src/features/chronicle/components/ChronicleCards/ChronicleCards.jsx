import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import PostImageGallery from '@shared/post-images/PostImageGallery.jsx';
import { normalizePostImages } from '@domain/feed/PostImages.js';
import EntryAccessBadge from '@features/chronicle/components/EntryAccessBadge/EntryAccessBadge.jsx';

function plainText(value = '') {
  return String(value)
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/(^|\n)#{1,6}\s+/g, '$1')
    .replace(/[*_~`>]+/g, '')
    .trim();
}

function relativeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date);
}

function EntryHeader({ entry, author, onOpenProfile }) {
  return (
    <header className="chronicle-card__header">
      <button type="button" onClick={() => onOpenProfile?.(author?.UUID)} disabled={!author?.UUID}>
        <ProfileIdentity identity={author} avatarOnly avatarSize={34} />
      </button>
      <div>
        <strong>{author?.username || 'Unknown'}</strong>
        <span>
          {relativeDate(entry.occurrenceAt)}
          {entry.publishedAt && relativeDate(entry.occurrenceAt) !== relativeDate(entry.publishedAt)
            ? ` · shared ${relativeDate(entry.publishedAt)}`
            : ''}
        </span>
      </div>
      <div className="chronicle-card__labels">
        <em>{entry.entryKind}</em>
        <EntryAccessBadge entry={entry} />
      </div>
    </header>
  );
}

export function ChronicleEntryCard({
  entry,
  author,
  onOpen,
  onOpenProfile,
}) {
  const body = plainText(entry.entry);
  const images = normalizePostImages(entry.images);
  const isMoment = entry.entryKind === 'moment';
  return (
    <article className={`chronicle-card chronicle-card--${entry.entryKind || 'entry'}`}>
      <EntryHeader entry={entry} author={author} onOpenProfile={onOpenProfile} />
      {entry.title && <h3>{entry.title}</h3>}
      {entry.subtitle && <p className="chronicle-card__subtitle">{entry.subtitle}</p>}
      {images.length > 0 && (
        <PostImageGallery images={images} title={entry.title || 'Chronicle image'} onOpen={() => onOpen?.(entry)} />
      )}
      {body && <p className={isMoment ? 'chronicle-card__moment' : 'chronicle-card__excerpt'}>{body}</p>}
      {entry.primaryStory && (
        <p className="chronicle-card__continuity">
          Part of {entry.primaryStory.title}
          {entry.storyOrdinal ? ` · Part ${entry.storyOrdinal}` : ''}
        </p>
      )}
      <footer>
        <button type="button" onClick={() => onOpen?.(entry)}>
          {entry.entryKind === 'essay' ? 'Read essay' : isMoment ? 'Open moment' : 'Read entry'}
        </button>
      </footer>
    </article>
  );
}

export function MomentBundleCard({ bundle, author, onOpen, onOpenProfile }) {
  return (
    <article className="chronicle-card chronicle-moment-bundle" aria-label={`${bundle.itemCount} Moments`}>
      <EntryHeader entry={bundle.items[0]} author={author} onOpenProfile={onOpenProfile} />
      <h3>{bundle.itemCount} moments from {relativeDate(bundle.items[0].occurrenceAt)}</h3>
      {bundle.items.map((item) => (
        <button type="button" key={item.UUID} className="chronicle-moment-bundle__item" onClick={() => onOpen?.(item)}>
          <time>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(item.occurrenceAt))}</time>
          <span>{plainText(item.entry) || item.title || 'Image moment'}</span>
        </button>
      ))}
    </article>
  );
}

export function StoryCard({
  story,
  latestEntry = null,
  visibleCount = 0,
  owner = false,
  onOpen,
  onAddEntry,
}) {
  return (
    <article className="chronicle-card chronicle-story-card">
      <span className="chronicle-kicker">{story.status || 'ongoing'} story</span>
      <h3>{story.title}</h3>
      {story.description && <p>{story.description}</p>}
      {visibleCount > 0 ? (
        <p className="chronicle-card__continuity">
          {visibleCount} visible {visibleCount === 1 ? 'entry' : 'entries'}
          {latestEntry ? ` · Latest: ${latestEntry.title || plainText(latestEntry.entry).slice(0, 60)}` : ''}
        </p>
      ) : (
        <div className="chronicle-story-card__empty">
          <strong>{owner ? 'Ready for its first Entry' : 'Nothing shared here yet'}</strong>
          <span>{owner ? 'Add writing when this chapter has something to hold.' : 'The author has not shared an Entry in this Story.'}</span>
        </div>
      )}
      <footer>
        <button type="button" onClick={() => onOpen?.(story)}>{visibleCount ? 'Read Story' : 'Open Story'}</button>
        {owner && !visibleCount && <button type="button" className="primary" onClick={() => onAddEntry?.(story)}>Add first Entry</button>}
      </footer>
    </article>
  );
}
