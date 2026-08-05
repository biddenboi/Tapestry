import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function dailyDiscoveryRandom(viewerUUID, viewerIGT) {
  const day = Math.floor(Number(viewerIGT || 0) / 86_400_000);
  const seedText = `${viewerUUID}:${day}`;
  let state = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    state ^= seedText.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export default function MobileChroniclePage() {
  const { databaseConnection, currentPlayer, domainRevisions } = useAppContext();
  const { openSurface } = useMobileSurface();
  const query = useMemo(() => new ChronicleQueryService(databaseConnection), [databaseConnection]);
  const [entries, setEntries] = useState([]);
  const [latestEntries, setLatestEntries] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [feedMode, setFeedMode] = useState('discover');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadedProfileRef = useRef(null);

  const load = useCallback(async () => {
    if (!currentPlayer?.UUID) return;
    const firstLoad = loadedProfileRef.current !== currentPlayer.UUID;
    if (firstLoad) setLoading(true);
    setError('');
    try {
      const viewerIGT = getCurrentIGT(currentPlayer);
      const [page, players] = await Promise.all([
        query.recent({ viewerUUID: currentPlayer.UUID, viewerIGT, limit: 40, bundleMoments: false }),
        databaseConnection.getPlayersAtIGT(viewerIGT),
      ]);
      const excluded = new Set(page.rawEntries.slice(0, 12).map((entry) => String(entry.UUID)));
      const resurfaced = await query.wander({
        viewerUUID: currentPlayer.UUID,
        viewerIGT,
        excluded,
        limit: 5,
        random: dailyDiscoveryRandom(currentPlayer.UUID, viewerIGT),
      });
      const inserts = new Map([[3, resurfaced[0]], [8, resurfaced[1]], [14, resurfaced[2]], [21, resurfaced[3]], [29, resurfaced[4]]]);
      const blended = [];
      page.rawEntries.forEach((entry, index) => {
        const memory = inserts.get(index);
        if (memory && !blended.some((item) => String(item.UUID) === String(memory.UUID))) blended.push({ ...memory, mobileResurfaced: true });
        if (!blended.some((item) => String(item.UUID) === String(entry.UUID))) blended.push(entry);
      });
      setLatestEntries(page.rawEntries);
      setEntries(blended);
      setProfiles(Object.fromEntries(players.map((player) => [String(player.UUID), player])));
      loadedProfileRef.current = currentPlayer.UUID;
    } catch (loadError) {
      setError(loadError?.message || 'Chronicle could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [currentPlayer, databaseConnection, query]);

  useEffect(() => { void load(); }, [load, domainRevisions.chronicle, domainRevisions.journals, domainRevisions.profiles]);

  const visible = useMemo(() => {
    const source = feedMode === 'latest' ? latestEntries : entries;
    const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return source;
    return source.filter((entry) => {
      const haystack = `${entry.title || ''}\n${entry.entry || ''}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [entries, feedMode, latestEntries, search]);

  return (
    <section className="mobile-page mobile-chronicle-page">
      <header className="mobile-page-header mobile-chronicle-header">
        <div><span>Writing</span><h1>Chronicle</h1></div>
        <div>
          <button type="button" className="mobile-icon-button" aria-label="Search Chronicle" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Icon name="search" size={18} /></button>
          <button type="button" className="mobile-icon-button primary" aria-label="Quick capture" onClick={() => openSurface('chronicle-composer', { onCreated: load })}><Icon name="notes" size={18} /></button>
        </div>
      </header>
      <div className="mobile-chronicle-modes" role="tablist" aria-label="Chronicle feed"><button type="button" role="tab" aria-selected={feedMode === 'discover'} className={feedMode === 'discover' ? 'is-active' : ''} onClick={() => setFeedMode('discover')}>Discover</button><button type="button" role="tab" aria-selected={feedMode === 'latest'} className={feedMode === 'latest' ? 'is-active' : ''} onClick={() => setFeedMode('latest')}>Latest</button></div>
      {searchOpen && <label className="mobile-chronicle-search"><span>Search</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} autoFocus placeholder="Search entries" /></label>}
      <main className="mobile-chronicle-list" aria-live="polite">
        {visible.map((entry) => {
          const author = profiles[String(entry.parent)] || { UUID: entry.parent, username: 'Unknown author' };
          return (
            <article key={entry.UUID} className="mobile-chronicle-card">
              <button type="button" onClick={() => openSurface('chronicle-entry', { entry, author, onChanged: load })}>
                <header><ProfileIdentity player={author} compact rank="compact" avatarSize={40} /><time>{new Date(entry.occurrenceAt || entry.publishedAt || entry.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</time></header>
                <div className="mobile-chronicle-card__meta"><span>{entry.mobileResurfaced ? 'From your archive' : entry.entryKind || 'Entry'}</span><span aria-label={`Visibility: ${entry.visibility || 'private'}`}>{visibilityGlyph(entry.visibility)}</span></div>
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
