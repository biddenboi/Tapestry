import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { usePanelLifecycle } from '@app/panel-lifecycle/PanelLifecycleContext.jsx';
import { getCurrentIGT } from '@domain/time/Time.js';
import { JournalShuffle } from '@domain/feed/JournalShuffle.js';
import ChronicleQueryService from '@data/persistence/services/ChronicleQueryService.js';
import { ChronicleEntryCard } from '@features/chronicle/components/ChronicleCards/ChronicleCards.jsx';
import ChronicleEntryModal from '@features/chronicle/modals/ChronicleEntryModal/ChronicleEntryModal.jsx';
import PageHeader from '@shared/ui/PageHeader.jsx';
import '@features/chronicle/Chronicle.css';
import '@features/feed/components/Feed/Feed.css';

const PAGE_SIZE = 12;

export default function FeedPage({ mobileRestricted = false }) {
  const { databaseConnection, currentPlayer, domainRevisions, openPanel } = useAppContext();
  const { canLoad, isActive } = usePanelLifecycle();
  const query = useMemo(() => new ChronicleQueryService(databaseConnection), [databaseConnection]);
  const [items, setItems] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const queueRef = useRef(null);
  const sequenceRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const scrollRef = useRef(null);
  const rowFor = useCallback((entry) => ({ key: ++sequenceRef.current, entry }), []);

  useEffect(() => {
    if (!canLoad) return;
    let cancelled = false;
    queueRef.current = null;
    setLoading(true);
    setError('');
    const viewerIGT = getCurrentIGT(currentPlayer);
    Promise.all([
      query.pastJournals({ viewerUUID: currentPlayer?.UUID, viewerIGT }),
      databaseConnection.getPlayersAtIGT(viewerIGT),
    ]).then(([journals, players]) => {
      if (cancelled) return;
      const queue = new JournalShuffle(journals);
      queueRef.current = queue;
      setItems(queue.next(PAGE_SIZE).map(rowFor));
      setProfiles(Object.fromEntries(players.map((player) => [player.UUID, player])));
      lastScrollTopRef.current = 0;
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }).catch((loadError) => {
      if (!cancelled) setError(loadError.message || 'Past journals could not be loaded.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canLoad, currentPlayer?.UUID, databaseConnection, query, rowFor, retry,
    domainRevisions.chronicle, domainRevisions.journals, domainRevisions.profiles]);

  const appendJournals = useCallback(() => {
    if (!isActive || loading) return;
    const page = queueRef.current?.next(PAGE_SIZE) || [];
    if (page.length) setItems((current) => [...current, ...page.map(rowFor)]);
  }, [isActive, loading, rowFor]);

  const onScroll = (event) => {
    const list = event.currentTarget;
    const scrollingDown = list.scrollTop > lastScrollTopRef.current;
    lastScrollTopRef.current = list.scrollTop;
    if (scrollingDown && list.scrollHeight - list.scrollTop - list.clientHeight < 360) appendJournals();
  };

  const openEntry = (entry) => NiceModal.show(ChronicleEntryModal, { item: entry, mobileRestricted });
  return (
    <section className="feed-wrap journal-feed">
      <PageHeader title="Feed" description="Past journals, rediscovered at random." className="feed-header" />
      <main className="feed-list" ref={scrollRef} onScroll={onScroll} aria-label="Random past journals" aria-busy={loading}>
        {loading && <p role="status">Loading journals…</p>}
        {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
        {!loading && !error && items.map(({ key, entry }) => (
          <ChronicleEntryCard key={key} entry={entry} author={profiles[entry.parent]} onOpen={openEntry}
            onOpenProfile={(id) => openPanel('profile', id)} />
        ))}
        {!loading && !error && !items.length && <p className="journal-feed__empty">No past journals are available yet.</p>}
        {!loading && !error && items.length > 0 && (
          <button type="button" className="journal-feed__more" onClick={appendJournals}>More journals</button>
        )}
      </main>
    </section>
  );
}
