import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { usePanelLifecycle } from '@app/panel-lifecycle/PanelLifecycleContext.jsx';
import { STORES } from '@domain/constants.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { bundleChronicleMoments } from '@domain/chronicle/MomentBundling.js';
import ChronicleQueryService from '@data/persistence/services/ChronicleQueryService.js';
import ChronicleSocialRepository from '@data/persistence/repositories/ChronicleSocialRepository.js';
import ChronicleStoryRepository from '@data/persistence/repositories/ChronicleStoryRepository.js';
import {
  ChronicleEntryCard,
  MomentBundleCard,
  StoryCard,
} from '@features/chronicle/components/ChronicleCards/ChronicleCards.jsx';
import ChronicleComposerModal from '@features/chronicle/modals/ChronicleComposerModal/ChronicleComposerModal.jsx';
import ChronicleEntryModal from '@features/chronicle/modals/ChronicleEntryModal/ChronicleEntryModal.jsx';
import ChroniclePage from '@features/chronicle/pages/ChroniclePage/ChroniclePage.jsx';
import StoryReaderPage from '@features/chronicle/pages/StoryReaderPage/StoryReaderPage.jsx';
import PageHeader from '@shared/ui/PageHeader.jsx';
import LocalSectionNav from '@shared/navigation/LocalSectionNav/LocalSectionNav.jsx';
import useOpeningTrail from '@features/opening-trail/useOpeningTrail.js';
import { useLocalSectionRoute } from '@shared/navigation/LocalSectionNav/LocalSectionRouteState.js';
import '@features/chronicle/Chronicle.css';

const MODES = Object.freeze([
  { id: 'recent', label: 'Recent', description: 'New writing shared with you, ordered by publication time.' },
  { id: 'global', label: 'Global', capability: 'feed.global', description: 'Writing every local profile in this Tapestry can read and edit.' },
  { id: 'wander', label: 'Wander', capability: 'feed.wander', description: 'Five older entries resurfaced for an intentional, finite browse.' },
  { id: 'stories', label: 'Stories', capability: 'feed.stories', description: 'Multi-entry collections for seasons, projects, and unfolding chapters.' },
  { id: 'essays', label: 'Essays', capability: 'feed.essays', description: 'Long-form pieces separated from short Entries and Moments.' },
  { id: 'yours', label: 'Yours', description: 'Your private drafts, published writing, revisits, and archive.' },
]);
const PAGE_SIZE = 12;

function itemPublishedAt(item) {
  return item.publishedAt || item.items?.[0]?.publishedAt || '';
}

function timeGroup(value) {
  const date = new Date(value);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (day === start) return 'Today';
  if (day === start - 86400000) return 'Yesterday';
  if (now.getTime() - day < 7 * 86400000) return 'Earlier this week';
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
}

function matchesSearch(item, query) {
  if (!query.trim()) return true;
  const entries = item.type === 'moment-bundle' ? item.items : [item];
  const text = entries.map((entry) => `${entry.title || ''}\n${entry.subtitle || ''}\n${entry.entry || ''}`).join('\n').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((term) => text.includes(term));
}

export default function FeedPage({ mobileRestricted = false }) {
  const {
    databaseConnection,
    currentPlayer,
    domainRevisions,
    openPanel,
    routeIntent,
    consumeRouteIntent,
    reportLocalSubpage,
  } = useAppContext();
  const { canLoad } = usePanelLifecycle();
  const openingTrail = useOpeningTrail();
  const availableModes = useMemo(() => (mobileRestricted ? [MODES[0]] : MODES), [mobileRestricted]);
  const feedNavItems = useMemo(() => availableModes.map((item) => ({
    ...item,
    silhouette: Boolean(item.capability && !openingTrail.isRevealed(item.capability)),
    revealHint: item.capability ? `The Opening Trail introduces ${item.label} after related first-use evidence.` : null,
  })), [availableModes, openingTrail.revealed]);
  const services = useMemo(() => ({
    query: new ChronicleQueryService(databaseConnection),
    social: new ChronicleSocialRepository(databaseConnection),
    stories: new ChronicleStoryRepository(databaseConnection),
  }), [databaseConnection]);
  const { activePageId: mode, selectPage: setMode } = useLocalSectionRoute({
    sectionId: 'feed',
    pages: availableModes,
    profileUUID: currentPlayer?.UUID,
    databaseConnection,
    routeIntent: routeIntent?.panel === 'feed' ? routeIntent : null,
    defaultPageId: 'recent',
    onIntentConsumed: consumeRouteIntent,
    onPageChange: reportLocalSubpage,
  });
  const [items, setItems] = useState([]);
  const [rawEntries, setRawEntries] = useState([]);
  const [stories, setStories] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [priorSeen, setPriorSeen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [search, setSearch] = useState('');
  const [wanderEntries, setWanderEntries] = useState([]);
  const [selectedStory, setSelectedStory] = useState(null);
  const [storyEntries, setStoryEntries] = useState([]);
  const [storyTitle, setStoryTitle] = useState('');
  const [storyComposerRequested, setStoryComposerRequested] = useState(false);
  const storyTitleRef = useRef(null);
  const loadedViewRef = useRef('');

  const viewerIGT = useMemo(
    () => getCurrentIGT(currentPlayer),
    [currentPlayer?.UUID, currentPlayer?.createdAt, domainRevisions.chronicle],
  );

  const loadRecent = useCallback(async ({ append = false } = {}) => {
    if (!currentPlayer?.UUID) return;
    const viewKey = `${currentPlayer.UUID}:${mode}`;
    const firstLoadForView = loadedViewRef.current !== viewKey;
    if (append) setLoadingOlder(true);
    else if (firstLoadForView) setLoading(true);
    try {
      const [page, allPlayers, feedState, allStories] = await Promise.all([
        services.query.recent({
          viewerUUID: currentPlayer.UUID,
          viewerIGT: getCurrentIGT(currentPlayer),
          cursor: append ? cursor : null,
          limit: PAGE_SIZE,
          bundleMoments: false,
        }),
        databaseConnection.getPlayersAtIGT(getCurrentIGT(currentPlayer)),
        services.social.getFeedViewState(currentPlayer.UUID),
        databaseConnection.getAll(STORES.chronicleStory),
      ]);
      const nextRaw = append
        ? [...rawEntries, ...page.rawEntries]
        : firstLoadForView
          ? page.rawEntries
          : [
              ...page.rawEntries,
              ...rawEntries.slice(PAGE_SIZE).filter((entry) => (
                !page.rawEntries.some((fresh) => String(fresh.UUID) === String(entry.UUID))
              )),
            ];
      setRawEntries(nextRaw);
      setItems(bundleChronicleMoments(nextRaw));
      setProfiles(Object.fromEntries(allPlayers.map((player) => [player.UUID, player])));
      setStories(allStories.filter((story) => (
        story.visibility === 'fellows' || String(story.parent) === String(currentPlayer.UUID)
      )));
      setHasMore(page.hasMore);
      setCursor(page.nextCursor);
      loadedViewRef.current = viewKey;
      if (!append) {
        setPriorSeen(feedState || null);
        if (page.rawEntries[0]) {
          services.social.saveFeedViewState(currentPlayer.UUID, page.rawEntries[0])
            .catch((error) => console.warn('[ChronicleFeed] cursor save failed:', error));
        }
      }
    } finally {
      setLoading(false);
      setLoadingOlder(false);
    }
  }, [
    currentPlayer,
    cursor,
    databaseConnection,
    mode,
    rawEntries,
    services.query,
    services.social,
  ]);

  useEffect(() => {
    if (!canLoad) return;
    if (mode === 'global' && currentPlayer?.UUID) {
      const viewKey = `${currentPlayer.UUID}:global`;
      if (loadedViewRef.current !== viewKey) setLoading(true);
      Promise.all([
        services.query.global({ viewerUUID: currentPlayer.UUID, viewerIGT, limit: PAGE_SIZE }),
        databaseConnection.getPlayersAtIGT(viewerIGT),
      ]).then(([page, allPlayers]) => {
        setRawEntries(page.rawEntries);
        setItems(page.entries);
        setProfiles(Object.fromEntries(allPlayers.map((player) => [player.UUID, player])));
        setHasMore(page.hasMore);
        setCursor(page.nextCursor);
        loadedViewRef.current = viewKey;
      }).catch((error) => console.warn('[GlobalFeed] load failed:', error))
        .finally(() => setLoading(false));
      return;
    }
    loadRecent().catch((error) => console.warn('[ChronicleFeed] load failed:', error));
    // Initial and domain revision refreshes intentionally reset to the stable first page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canLoad,
    currentPlayer?.UUID,
    domainRevisions.chronicle,
    domainRevisions.journals,
    domainRevisions.profiles,
    mode,
  ]);

  useEffect(() => {
    if (mode !== 'wander' || !currentPlayer?.UUID) return;
    const viewKey = `${currentPlayer.UUID}:wander`;
    if (loadedViewRef.current !== viewKey) setLoading(true);
    services.query.wander({
      viewerUUID: currentPlayer.UUID,
      viewerIGT,
      limit: 5,
    }).then((nextEntries) => {
      setWanderEntries(nextEntries);
      loadedViewRef.current = viewKey;
    }).finally(() => setLoading(false));
  }, [currentPlayer?.UUID, mode, services.query, viewerIGT]);

  useEffect(() => {
    if (mode !== 'stories' || loading || !storyComposerRequested) return;
    storyTitleRef.current?.focus();
    setStoryComposerRequested(false);
  }, [loading, mode, storyComposerRequested]);

  const openStoryComposer = () => {
    setSearch('');
    setStoryComposerRequested(true);
    setMode('stories');
  };

  const openEntry = useCallback((entry) => {
    NiceModal.show(ChronicleEntryModal, {
      item: entry,
      mobileRestricted,
      onUpdated: (updated) => {
        setRawEntries((rows) => rows.map((row) => row.UUID === updated.UUID ? updated : row));
      },
    });
  }, [mobileRestricted]);

  const openStory = async (story) => {
    const result = await services.query.story(story.UUID, {
      viewerUUID: currentPlayer.UUID,
      viewerIGT,
    });
    setSelectedStory(result.story);
    setStoryEntries(result.entries);
  };

  const addEntryToStory = (story) => {
    NiceModal.show(ChronicleComposerModal, {
      initialKind: 'entry',
      initialVisibility: story.visibility === 'fellows' ? 'fellows' : 'private',
      initialStoryId: story.UUID,
      onCreated: async () => {
        const result = await services.query.story(story.UUID, {
          viewerUUID: currentPlayer.UUID,
          viewerIGT,
        });
        setSelectedStory(result.story);
        setStoryEntries(result.entries);
        await loadRecent();
      },
    });
  };

  if (selectedStory) {
    return (
      <div className="feed-wrap chronicle-feed">
        <StoryReaderPage
          story={selectedStory}
          entries={storyEntries}
          owner={String(selectedStory.parent) === String(currentPlayer?.UUID)}
          onClose={() => setSelectedStory(null)}
          onAddEntry={mobileRestricted ? undefined : () => addEntryToStory(selectedStory)}
          onRead={(entry) => services.social.saveStoryReadState(currentPlayer.UUID, selectedStory.UUID, entry.UUID)}
        />
      </div>
    );
  }

  const visibleItems = (mode === 'wander'
    ? wanderEntries
    : mode === 'global'
      ? rawEntries
    : mode === 'essays'
      ? rawEntries.filter((entry) => entry.entryKind === 'essay')
      : items
  ).filter((item) => matchesSearch(item, search));
  const seenAt = priorSeen?.lastSeenPublishedAt || null;
  let lastGroup = '';
  let caughtUpShown = false;

  return (
    <div className="feed-wrap chronicle-feed">
      <PageHeader
        eyebrow="Writing & collaboration"
        title={mobileRestricted ? 'Chronicle' : 'Feed'}
        className="feed-header chronicle-feed__header"
        actions={(
          <div className="chronicle-feed__actions">
            {!mobileRestricted && <button type="button" onClick={openStoryComposer}>New Story</button>}
            <button
              type="button"
              onClick={() => NiceModal.show(ChronicleComposerModal, {
                initialKind: 'moment',
                initialVisibility: 'private',
                quickCapture: true,
                mobileRestricted,
              })}
            >
              Quick Capture
            </button>
            {!mobileRestricted && <button
              type="button"
              className="primary"
              onClick={() => NiceModal.show(ChronicleComposerModal, {
                initialKind: 'entry',
                initialVisibility: mode === 'global' ? 'global' : 'fellows',
              })}
              disabled={!currentPlayer?.UUID}
            >
              {mode === 'global' ? 'New Global Entry' : 'Post to Feed'}
            </button>}
          </div>
        )}
      >
        <div className="chronicle-feed__search">
          <input
            id="chronicle-feed-search"
            type="search"
            aria-label="Search feed"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search posts"
          />
        </div>
      </PageHeader>

      {!mobileRestricted && <LocalSectionNav
        items={feedNavItems}
        value={mode}
        onChange={(next) => { setMode(next); setSearch(''); setStoryComposerRequested(false); }}
        label="Feed sections"
      />}

      {mode === 'yours' ? (
        <ChroniclePage embedded onOpenEntry={openEntry} profilesById={profiles} />
      ) : (
      <main className="feed-list chronicle-feed__list" aria-live="polite">
        {loading && <div className="chronicle-feed__loading" role="status">Loading…</div>}

        {!loading && mode === 'stories' && (
          <>
          {!mobileRestricted && <form className="chronicle-story-create" onSubmit={async (event) => {
            event.preventDefault();
            if (!storyTitle.trim() || !currentPlayer?.UUID) return;
            await services.stories.save({
              UUID: crypto.randomUUID(),
              parent: currentPlayer.UUID,
              title: storyTitle.trim(),
              visibility: 'private',
            });
            setStoryTitle('');
            await loadRecent();
          }}>
            <div className="chronicle-story-create__intro">
              <label htmlFor="feed-story-title">Create a Story</label>
              <p>Stories organize related writing into a narrative. Unlike Goals, they do not track completion; unlike Areas, they do not define an ongoing responsibility.</p>
            </div>
            <input
              id="feed-story-title"
              ref={storyTitleRef}
              value={storyTitle}
              onChange={(event) => setStoryTitle(event.target.value)}
              placeholder="A season, project, or unfolding chapter"
              maxLength={240}
            />
            <button type="submit" className="primary" disabled={!storyTitle.trim()}>Create Story</button>
          </form>}
          <div className="chronicle-grid">
            {stories.map((story) => {
              const storyItems = rawEntries.filter((entry) => entry.primaryStoryId === story.UUID);
              return (
                <div key={story.UUID} className="chronicle-story-tile">
                  <StoryCard
                    story={story}
                    latestEntry={storyItems[0]}
                    visibleCount={storyItems.length}
                    owner={String(story.parent) === String(currentPlayer?.UUID)}
                    onOpen={openStory}
                    onAddEntry={mobileRestricted ? undefined : addEntryToStory}
                  />
                  {!mobileRestricted && String(story.parent) === String(currentPlayer?.UUID) && (
                    <div className="chronicle-story-tile__actions">
                      <button type="button" onClick={async () => {
                        await services.stories.save({
                          ...story,
                          visibility: story.visibility === 'fellows' ? 'private' : 'fellows',
                        });
                        await loadRecent();
                      }}>
                        {story.visibility === 'fellows' ? 'Make private' : 'Share with Fellows'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {!stories.length && <p className="chronicle-quiet-copy">No shared Stories yet.</p>}
          </div>
          </>
        )}

        {!loading && mode !== 'stories' && visibleItems.map((item) => {
          const publishedAt = itemPublishedAt(item);
          const group = timeGroup(publishedAt);
          const showGroup = group !== lastGroup;
          lastGroup = group;
          const reachedSeen = mode === 'recent' && seenAt && publishedAt <= seenAt && !caughtUpShown;
          if (reachedSeen) caughtUpShown = true;
          const author = profiles[item.parent || item.items?.[0]?.parent];
          return (
            <div key={item.UUID} className="chronicle-feed__row">
              {showGroup && <h2 className="chronicle-time-group">{group}</h2>}
              {reachedSeen && (
                <div className="chronicle-caught-up">
                  <span>You’re caught up</span>
                </div>
              )}
              {item.type === 'moment-bundle' ? (
                <MomentBundleCard bundle={item} author={author} onOpen={openEntry} onOpenProfile={(id) => openPanel('profile', id)} />
              ) : (
                <ChronicleEntryCard entry={item} author={author} onOpen={openEntry} onOpenProfile={(id) => openPanel('profile', id)} />
              )}
            </div>
          );
        })}

        {!loading && mode === 'wander' && (
          <div className="chronicle-feed-end">
            <strong>That’s five.</strong>
            <button type="button" onClick={() => setMode('recent')}>Return to Recent</button>
          </div>
        )}

        {!loading && mode !== 'stories' && visibleItems.length === 0 && (
          <p className="chronicle-quiet-copy">
            {search ? 'No visible writing matches.' : mode === 'global' ? 'No Global Entries have been created yet.' : 'No shared writing is available yet.'}
          </p>
        )}

        {!loading && mode === 'recent' && (
          <div className="chronicle-feed-end">
            {hasMore ? (
              <>
                <button type="button" onClick={() => loadRecent({ append: true })} disabled={loadingOlder}>
                  {loadingOlder ? 'Loading…' : 'Older shared writing'}
                </button>
              </>
            ) : (
              <strong>End of the shared Chronicle</strong>
            )}
          </div>
        )}
      </main>
      )}
    </div>
  );
}
