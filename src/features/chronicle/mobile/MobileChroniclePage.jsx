import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import ChronicleQueryService from '@data/persistence/services/ChronicleQueryService.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import { Icon } from '@shared/icons/Icon.jsx';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';

function entryPreview(entry) {
  return String(entry.entry || '').replace(/[#*_>`~\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function visibilityGlyph(value) {
  return value === 'global' ? '◎' : value === 'fellows' ? '◉' : '●';
}

export default function MobileChroniclePage() {
  const { databaseConnection, currentPlayer, domainRevisions } = useAppContext();
  const { openSurface } = useMobileSurface();
  const query = useMemo(() => new ChronicleQueryService(databaseConnection), [databaseConnection]);
  const [entries, setEntries] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!currentPlayer?.UUID) return;
    setLoading(true);
    setError('');
    try {
      const viewerIGT = getCurrentIGT(currentPlayer);
      const [page, players] = await Promise.all([
        query.recent({ viewerUUID: currentPlayer.UUID, viewerIGT, limit: 40, bundleMoments: false }),
        databaseConnection.getPlayersAtIGT(viewerIGT),
      ]);
      setEntries(page.rawEntries);
      setProfiles(Object.fromEntries(players.map((player) => [String(player.UUID), player])));
    } catch (loadError) {
      setError(loadError?.message || 'Chronicle could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [currentPlayer, databaseConnection, query]);

  useEffect(() => { void load(); }, [load, domainRevisions.chronicle, domainRevisions.journals, domainRevisions.profiles]);

  const visible = useMemo(() => {
    const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return entries;
    return entries.filter((entry) => {
      const haystack = `${entry.title || ''}\n${entry.entry || ''}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [entries, search]);

  return (
    <section className="mobile-page mobile-chronicle-page">
      <header className="mobile-page-header mobile-chronicle-header">
        <div><span>Writing</span><h1>Chronicle</h1></div>
        <div>
          <button type="button" className="mobile-icon-button" aria-label="Search Chronicle" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Icon name="search" size={18} /></button>
          <button type="button" className="mobile-icon-button primary" aria-label="Quick capture" onClick={() => openSurface('chronicle-composer', { onCreated: load })}><Icon name="notes" size={18} /></button>
        </div>
      </header>
      {searchOpen && <label className="mobile-chronicle-search"><span>Search</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} autoFocus placeholder="Search entries" /></label>}
      <main className="mobile-chronicle-list" aria-live="polite">
        {visible.map((entry) => {
          const author = profiles[String(entry.parent)] || { UUID: entry.parent, username: 'Unknown author' };
          return (
            <article key={entry.UUID} className="mobile-chronicle-card">
              <button type="button" onClick={() => openSurface('chronicle-entry', { entry, author })}>
                <header><ProfileIdentity player={author} compact rank="compact" avatarSize={40} /><time>{new Date(entry.occurrenceAt || entry.publishedAt || entry.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</time></header>
                <div className="mobile-chronicle-card__meta"><span>{entry.entryKind || 'Entry'}</span><span aria-label={`Visibility: ${entry.visibility || 'private'}`}>{visibilityGlyph(entry.visibility)}</span></div>
                {entry.title && <strong>{entry.title}</strong>}
                <p>{entryPreview(entry)}</p>
              </button>
            </article>
          );
        })}
        {!loading && !visible.length && <div className="mobile-compact-empty"><strong>{search ? 'No matching entries' : 'No shared entries yet'}</strong><span>{search ? 'Try another search.' : 'Quick Capture starts a local draft.'}</span></div>}
      </main>
      {loading && <div className="mobile-feature-loading">Loading Chronicle…</div>}
      {error && <div className="mobile-page-error" role="alert">{error}</div>}
    </section>
  );
}
