import { Fragment, useCallback, useContext, useEffect, useRef, useState } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';
import { getRank, getRankLabel } from '../../utils/Helpers/Rank.js';
import { UTCStringToLocalDate } from '../../utils/Helpers/Time.js';
import ProfilePicture from '../ProfilePicture/ProfilePicture.jsx';
import MarkdownEditor from '../MarkdownEditor/MarkdownEditor.jsx';
import JournalDetailModal from '../../Modals/JournalDetailModal/JournalDetailModal.jsx';
import './Feed.css';

/* ══════════════════════════════════════════════════════════════════════════
   INFINITE SCROLL CONSTANTS
   ══════════════════════════════════════════════════════════════════════════
   VISIBLE_INIT      – entries rendered on first load
   VISIBLE_INCREMENT – entries appended each time the sentinel fires
   BUFFER_TARGET     – how many entries to keep preloaded (off-screen)
   TRIGGER_AT        – fire loadMore when this many displayed entries remain
                       before the bottom (i.e. sentinel sits at index
                       displayed.length - TRIGGER_AT)
   ══════════════════════════════════════════════════════════════════════════ */
const VISIBLE_INIT      = 20;
const VISIBLE_INCREMENT = 20;
const BUFFER_TARGET     = 50;
const TRIGGER_AT        = 10;

/* ── Pure random shuffle (Fisher-Yates) ─────────────────────────────────── */
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── Vote controls ──────────────────────────────────────────────────────── */
function VoteBar({ votes = {}, voterUUID, onVote }) {
  const score  = Object.values(votes).reduce((s, v) => s + (Number(v) || 0), 0);
  const myVote = voterUUID ? (votes[voterUUID] || 0) : 0;

  return (
    <div className="feed-vote-bar">
      <button
        type="button"
        className={`feed-vote-btn feed-vote-btn--up${myVote === 1 ? ' is-active' : ''}`}
        onClick={() => onVote?.(1)}
        disabled={!voterUUID}
        title={myVote === 1 ? 'Remove upvote' : 'Upvote'}
        aria-label="Upvote"
      >▲</button>
      <span
        className={`feed-vote-score${score > 0 ? ' pos' : score < 0 ? ' neg' : ''}`}
        aria-label={`Score ${score}`}
      >{score}</span>
      <button
        type="button"
        className={`feed-vote-btn feed-vote-btn--down${myVote === -1 ? ' is-active' : ''}`}
        onClick={() => onVote?.(-1)}
        disabled={!voterUUID}
        title={myVote === -1 ? 'Remove downvote' : 'Downvote'}
        aria-label="Downvote"
      >▼</button>
    </div>
  );
}

/* ── Single feed card ───────────────────────────────────────────────────── */
function FeedCard({ entry, author, commentCount, currentPlayer, onVote, onOpenProfile, onOpenEntry }) {
  const [expanded, setExpanded] = useState(false);

  const rank      = getRank(author?.elo || 0);
  const rankLabel = getRankLabel(author?.elo || 0);

  const frameStyle = {
    borderColor: rank.color,
    boxShadow:   `0 0 10px ${rank.glow}`,
  };

  const bodyText  = entry.entry || '';
  const isLong    = bodyText.length > 320;
  const displayed = !isLong || expanded ? bodyText : bodyText.slice(0, 320);

  const handleVote = (delta) => {
    if (!currentPlayer?.UUID) return;
    const prev     = (entry.votes || {})[currentPlayer.UUID] || 0;
    const next     = prev === delta ? 0 : delta;
    const nextVotes = { ...(entry.votes || {}) };
    if (next === 0) delete nextVotes[currentPlayer.UUID];
    else nextVotes[currentPlayer.UUID] = next;
    onVote?.(entry, nextVotes);
  };

  return (
    <article className="feed-card">
      {/* ── Author header ──────────────────────────────── */}
      <div className="feed-card-header">
        <div className="feed-author-left">
          <button
            type="button"
            className="feed-pfp-frame"
            style={frameStyle}
            onClick={() => author?.UUID && onOpenProfile?.(author.UUID)}
            title={`View ${author?.username || 'profile'}`}
          >
            <ProfilePicture
              src={author?.profilePicture}
              username={author?.username || '?'}
              size={36}
            />
          </button>

          <div className="feed-author-info">
            <button
              type="button"
              className="feed-author-name"
              onClick={() => author?.UUID && onOpenProfile?.(author.UUID)}
              title={`View ${author?.username || 'profile'}`}
            >
              {author?.username || 'Unknown'}
            </button>
            <span className="feed-author-rank" style={{ color: rank.color }}>
              {rank.icon} {rankLabel}
            </span>
          </div>
        </div>

        <span className="feed-entry-date">{UTCStringToLocalDate(entry.createdAt)}</span>
      </div>

      {/* ── Title ─────────────────────────────────────── */}
      {entry.title && (
        <h3 className="feed-entry-title">{entry.title}</h3>
      )}

      {/* ── Body preview ──────────────────────────────── */}
      {bodyText ? (
        <div className="feed-entry-body">
          <MarkdownEditor
            value={displayed}
            readOnly
            className="feed-entry-md"
          />
          {isLong && (
            <button
              type="button"
              className="feed-expand-btn"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? '▲ COLLAPSE' : '▼ READ MORE'}
            </button>
          )}
        </div>
      ) : (
        <div className="feed-entry-empty">No entry text.</div>
      )}

      {/* ── Footer: votes + comment count + open ──────── */}
      <div className="feed-card-footer">
        <VoteBar
          votes={entry.votes || {}}
          voterUUID={currentPlayer?.UUID}
          onVote={handleVote}
        />

        <button
          type="button"
          className="feed-comment-btn"
          onClick={() => onOpenEntry?.(entry)}
          title="View comments"
        >
          <span className="feed-comment-icon">◎</span>
          <span className="feed-comment-count">{commentCount}</span>
          {commentCount === 1 ? ' comment' : ' comments'}
        </button>

        <button
          type="button"
          className="feed-open-btn"
          onClick={() => onOpenEntry?.(entry)}
        >
          OPEN ENTRY
        </button>
      </div>
    </article>
  );
}

/* ── Skeleton loading cards ─────────────────────────────────────────────── */
function FeedSkeleton() {
  return (
    <div className="feed-skeleton">
      {[1, 2, 3].map((n) => (
        <div key={n} className="feed-card feed-card--skeleton">
          <div className="feed-card-header">
            <div className="skel skel-avatar" />
            <div className="feed-author-info">
              <div className="skel skel-name" />
              <div className="skel skel-rank" />
            </div>
          </div>
          <div className="skel skel-title" />
          <div className="skel skel-body" />
          <div className="skel skel-body skel-body--short" />
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN FEED COMPONENT
   ══════════════════════════════════════════════════════════════════════════

   Memory layout (all refs except `displayed` which drives rendering):

     allEntriesRef  ← full DB snapshot; updated on vote so reshuffle is fresh
         │
         └─► on init / reshuffle: shuffle → split into three tiers
                 │
                 ├─ displayed  (state)  – currently rendered cards
                 ├─ bufferRef  (ref)    – BUFFER_TARGET entries ready to show
                 └─ poolRef    (ref)    – remainder waiting to fill the buffer

   On scroll: sentinel at (displayed.length - TRIGGER_AT) fires loadMore()
     → pops VISIBLE_INCREMENT from bufferRef → appends to displayed
     → refills bufferRef up to BUFFER_TARGET from poolRef

   On vote: patch all three tiers + allEntriesRef in-place; persist to DB.
            No re-fetch, no re-shuffle.

   ══════════════════════════════════════════════════════════════════════════ */
export default function Feed() {
  const { databaseConnection, currentPlayer, openPanel } = useContext(AppContext);

  /* ── In-memory tiers (refs — mutation never triggers re-renders) ──────── */
  const allEntriesRef  = useRef([]);   // full DB snapshot (for reshuffle + vote sync)
  const bufferRef      = useRef([]);   // preloaded, awaiting display
  const poolRef        = useRef([]);   // not yet buffered
  const loadingMoreRef = useRef(false);
  const sentinelRef    = useRef(null);

  /* ── Rendered state ───────────────────────────────────────────────────── */
  const [displayed,     setDisplayed]     = useState([]);
  const [playersByUUID, setPlayersByUUID] = useState({});
  const [commentCounts, setCommentCounts] = useState({});
  const [loading,       setLoading]       = useState(true);

  /* ── Seed all three tiers from a pre-shuffled array ─────────────────── */
  const initFromShuffled = useCallback((shuffled) => {
    bufferRef.current = shuffled.slice(VISIBLE_INIT, VISIBLE_INIT + BUFFER_TARGET);
    poolRef.current   = shuffled.slice(VISIBLE_INIT + BUFFER_TARGET);
    setDisplayed(shuffled.slice(0, VISIBLE_INIT));
  }, []);

  /* ── Initial data fetch ──────────────────────────────────────────────── */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [allEntries, allPlayers, allComments] = await Promise.all([
        databaseConnection.getAll(STORES.journal),
        databaseConnection.getAllPlayers(),
        databaseConnection.getAll(STORES.journalComment),
      ]);

      const byUUID = Object.fromEntries(allPlayers.map((p) => [p.UUID, p]));

      const counts = {};
      for (const c of allComments) {
        if (c.journalUUID) counts[c.journalUUID] = (counts[c.journalUUID] || 0) + 1;
      }

      setPlayersByUUID(byUUID);
      setCommentCounts(counts);
      allEntriesRef.current = allEntries;
      initFromShuffled(shuffleArray(allEntries));
    } finally {
      setLoading(false);
    }
  }, [databaseConnection, initFromShuffled]);

  useEffect(() => { load(); }, [load]);

  /* ── Pop the next batch from buffer → displayed; refill buffer from pool */
  const loadMore = useCallback(() => {
    if (loadingMoreRef.current) return;

    // When both buffer and pool are dry, re-shuffle the full snapshot to keep
    // the scroll going forever. This is what makes it truly infinite.
    if (bufferRef.current.length === 0) {
      if (allEntriesRef.current.length === 0) return; // nothing at all
      const reshuffled  = shuffleArray(allEntriesRef.current);
      bufferRef.current = reshuffled.slice(0, BUFFER_TARGET);
      poolRef.current   = reshuffled.slice(BUFFER_TARGET);
    }

    loadingMoreRef.current = true;

    // Consume from buffer
    const batch       = bufferRef.current.slice(0, VISIBLE_INCREMENT);
    bufferRef.current = bufferRef.current.slice(VISIBLE_INCREMENT);

    // Refill buffer from pool (up to BUFFER_TARGET)
    const needed = Math.max(0, BUFFER_TARGET - bufferRef.current.length);
    if (needed > 0 && poolRef.current.length > 0) {
      bufferRef.current = [...bufferRef.current, ...poolRef.current.slice(0, needed)];
      poolRef.current   = poolRef.current.slice(needed);
    }

    setDisplayed((prev) => [...prev, ...batch]);
    loadingMoreRef.current = false;
  }, []); // stable: only touches refs

  /* ── Sentinel observer ───────────────────────────────────────────────── */
  // Re-attach each time displayed.length changes so the sentinel element
  // (which shifts position in the DOM) gets a fresh observer.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [displayed.length, loadMore]);

  /* ── Vote: patch all tiers in-memory, persist to DB (no re-fetch) ──── */
  const handleVote = useCallback(async (entry, nextVotes) => {
    const updated = { ...entry, votes: nextVotes };

    // Persist
    await databaseConnection.add(STORES.journal, updated);

    // Patch helper
    const patch = (arr) => arr.map((e) => (e.UUID === entry.UUID ? updated : e));

    // Update all in-memory tiers so vote state is consistent everywhere
    setDisplayed(patch);
    bufferRef.current     = patch(bufferRef.current);
    poolRef.current       = patch(poolRef.current);
    allEntriesRef.current = patch(allEntriesRef.current);
  }, [databaseConnection]);

  /* ── Reshuffle: re-shuffle the full snapshot and restart all tiers ──── */
  const handleReshuffle = useCallback(() => {
    // allEntriesRef always has the most up-to-date vote state
    initFromShuffled(shuffleArray(allEntriesRef.current));
  }, [initFromShuffled]);

  const handleOpenProfile = useCallback((uuid) => { openPanel('profile', uuid); }, [openPanel]);
  const handleOpenEntry   = useCallback((entry) => {
    NiceModal.show(JournalDetailModal, { item: entry });
  }, []);

  // Sentinel sits TRIGGER_AT slots before the last rendered card.
  // If displayed is shorter than TRIGGER_AT, clamp to 0 so it fires immediately
  // and keeps filling until there's enough content.
  const sentinelIdx = Math.max(0, displayed.length - TRIGGER_AT);
  const totalCount  = allEntriesRef.current.length;
  // Scroll is infinite: as long as there are any entries, there is always more.
  const hasMore     = totalCount > 0;

  return (
    <div className="feed-wrap">
      {/* ── Feed header ──────────────────────────────── */}
      <div className="feed-header">
        <div className="feed-header-left">
          <span className="feed-header-icon">⬟</span>
          <div>
            <div className="feed-header-title">FEED</div>
            <div className="feed-header-sub">
              {loading
                ? '—'
                : `${displayed.length} / ${totalCount} entr${totalCount === 1 ? 'y' : 'ies'}`}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="feed-reshuffle-btn"
          onClick={handleReshuffle}
          title="Reshuffle feed"
          disabled={loading}
        >
          ⟳ RESHUFFLE
        </button>
      </div>

      {/* ── Cards ────────────────────────────────────── */}
      <div className="feed-list">
        {loading && <FeedSkeleton />}

        {!loading && displayed.length === 0 && (
          <div className="feed-empty">
            <span className="feed-empty-icon">✎</span>
            <p>No journal entries yet.</p>
            <p className="feed-empty-sub">Write something in your LOG and it will appear here.</p>
          </div>
        )}

        {!loading && displayed.map((entry, idx) => (
          <Fragment key={entry.UUID}>
            {/* Sentinel sits TRIGGER_AT entries before the bottom.
                When it scrolls into view the IntersectionObserver fires
                loadMore(), popping the next batch out of the buffer. */}
            {idx === sentinelIdx && (
              <div
                ref={sentinelRef}
                style={{ height: 0, overflow: 'hidden' }}
                aria-hidden="true"
              />
            )}
            <FeedCard
              entry={entry}
              author={playersByUUID[entry.parent]}
              commentCount={commentCounts[entry.UUID] || 0}
              currentPlayer={currentPlayer}
              onVote={handleVote}
              onOpenProfile={handleOpenProfile}
              onOpenEntry={handleOpenEntry}
            />
          </Fragment>
        ))}

        {/* Feed is infinite — no end-of-feed banner needed */}
      </div>
    </div>
  );
}