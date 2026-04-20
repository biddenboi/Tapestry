import './JournalDetailModal.css';
import { useContext, useEffect, useState, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';
import { UTCStringToLocalDate, UTCStringToLocalTime, getCurrentIGT } from '../../utils/Helpers/Time.js';
import { getRank } from '../../utils/Helpers/Rank.js';
import ProfilePicture from '../../components/ProfilePicture/ProfilePicture.jsx';
import MarkdownEditor from '../../components/MarkdownEditor/MarkdownEditor.jsx';
import { checkPassiveAchievements, getAchievementByKey } from '../../utils/Achievements.js';

function CommentRow({ comment, author, isSelf, voterUUID, onDelete, onVote, onOpenProfile }) {
  const rank = getRank(author?.elo || 0);
  const navUUID = author?.UUID || comment.authorUUID;
  const canOpen = !!navUUID && typeof onOpenProfile === 'function';

  const frameStyle = {
    borderColor: rank.color,
    boxShadow: `0 0 8px ${rank.glow}`,
  };
  const titleText = canOpen
    ? `View ${author?.username || 'profile'}`
    : (author?.username || 'Unknown');

  const handleProfileClick = () => { if (canOpen) onOpenProfile(navUUID); };

  const votes = comment.votes || {};
  const score = Object.values(votes).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const myVote = voterUUID ? (votes[voterUUID] || 0) : 0;
  const canVote = !!voterUUID;

  return (
    <div className={`journal-comment ${isSelf ? 'journal-comment--self' : ''}`}>
      {canOpen ? (
        <button
          type="button"
          className="journal-comment-pfp-frame journal-comment-pfp-frame--btn"
          style={frameStyle}
          onClick={handleProfileClick}
          title={titleText}
        >
          <ProfilePicture src={author?.profilePicture} username={author?.username || '?'} size={28} />
        </button>
      ) : (
        <div className="journal-comment-pfp-frame" style={frameStyle} title={titleText}>
          <ProfilePicture src={author?.profilePicture} username={author?.username || '?'} size={28} />
        </div>
      )}

      <div className="journal-comment-body">
        <div className="journal-comment-meta">
          {canOpen ? (
            <button
              type="button"
              className="journal-comment-author journal-comment-author--btn"
              onClick={handleProfileClick}
              title={titleText}
            >
              {author?.username || 'Unknown'}
            </button>
          ) : (
            <span className="journal-comment-author">{author?.username || 'Unknown'}</span>
          )}
          <span className="journal-comment-date">
            {UTCStringToLocalDate(comment.createdAt)} · {UTCStringToLocalTime(comment.createdAt)}
          </span>
          {isSelf && (
            <button
              type="button"
              className="journal-comment-delete"
              onClick={() => onDelete(comment)}
              title="Delete"
            >
              ✕
            </button>
          )}
        </div>
        <div className="journal-comment-text">{comment.text}</div>

        {/* Voting bar — available to any authenticated viewer */}
        <div className="journal-comment-votes">
          <button
            type="button"
            className={`jc-vote-btn jc-vote-btn--up${myVote === 1 ? ' is-active' : ''}`}
            onClick={() => canVote && onVote?.(comment, 1)}
            disabled={!canVote}
            title={myVote === 1 ? 'Remove upvote' : 'Upvote'}
            aria-label="Upvote comment"
          >▲</button>
          <span
            className={`jc-vote-score${score > 0 ? ' jc-vote-score--pos' : score < 0 ? ' jc-vote-score--neg' : ''}`}
            aria-label={`Score ${score}`}
          >{score}</span>
          <button
            type="button"
            className={`jc-vote-btn jc-vote-btn--down${myVote === -1 ? ' is-active' : ''}`}
            onClick={() => canVote && onVote?.(comment, -1)}
            disabled={!canVote}
            title={myVote === -1 ? 'Remove downvote' : 'Downvote'}
            aria-label="Downvote comment"
          >▼</button>
        </div>
      </div>
    </div>
  );
}

export default NiceModal.create(({ item }) => {
  const { databaseConnection, currentPlayer, refreshApp, notify, openPanel } = useContext(AppContext);
  const modal = useModal();

  const [entry, setEntry]           = useState(item);
  const [editing, setEditing]       = useState(false);
  const [draftTitle, setDraftTitle] = useState(item?.title || '');
  const [draftBody, setDraftBody]   = useState(item?.entry || '');

  const [comments, setComments]             = useState([]);
  const [authorsByUUID, setAuthorsByUUID]   = useState({});
  const [newComment, setNewComment]         = useState('');

  const isOwner = entry?.parent && currentPlayer?.UUID && entry.parent === currentPlayer.UUID;

  const loadComments = useCallback(async () => {
    if (!entry?.UUID) return;
    const [rows, allPlayers] = await Promise.all([
      databaseConnection.getCommentsForJournal(entry.UUID),
      databaseConnection.getAllPlayers(),
    ]);
    const byUUID = Object.fromEntries(allPlayers.map((p) => [p.UUID, p]));
    setComments(rows);
    setAuthorsByUUID(byUUID);
  }, [databaseConnection, entry?.UUID]);

  useEffect(() => { loadComments(); }, [loadComments]);

  if (!modal.visible || !entry) return null;

  const close = () => { modal.hide(); modal.remove(); };

  const handleOpenProfile = typeof openPanel === 'function'
    ? (profileUUID) => { close(); openPanel('profile', profileUUID); }
    : null;

  const handleSaveEdit = async () => {
    const updated = {
      ...entry,
      title: draftTitle,
      entry: draftBody,
      editedAt: new Date().toISOString(),
    };
    await databaseConnection.add(STORES.journal, updated);
    setEntry(updated);
    setEditing(false);
    refreshApp();
    notify?.({ title: 'Entry updated', message: 'Your journal entry has been saved.', kind: 'success', persist: false });

    // Check legacy / basket achievements after journal save
    const freshPlayer = await databaseConnection.getCurrentPlayer();
    if (freshPlayer && freshPlayer.UUID === currentPlayer?.UUID) {
      const newlyEarned = await checkPassiveAchievements(freshPlayer, databaseConnection);
      for (const key of newlyEarned) {
        const a = getAchievementByKey(key);
        if (a) notify?.({ title: 'Achievement Unlocked', message: a.label, kind: 'success', persist: false });
      }
    }
  };

  const handleCancelEdit = () => {
    setDraftTitle(entry.title || '');
    setDraftBody(entry.entry || '');
    setEditing(false);
  };

  const handleAddComment = async () => {
    const text = newComment.trim();
    if (!text || !currentPlayer?.UUID) return;
    const now = new Date().toISOString();
    const record = {
      UUID: uuid(),
      journalUUID: entry.UUID,
      authorUUID: currentPlayer.UUID,
      text,
      createdAt: now,
      inGameTimestamp: getCurrentIGT(currentPlayer),
    };
    await databaseConnection.add(STORES.journalComment, record);
    setNewComment('');
    loadComments();
    refreshApp();
  };

  const handleDeleteComment = async (comment) => {
    await databaseConnection.remove(STORES.journalComment, comment.UUID);
    loadComments();
    refreshApp();
  };

  const handleVoteComment = async (comment, delta) => {
    if (!currentPlayer?.UUID) return;
    const prevVotes = comment.votes || {};
    const prev = prevVotes[currentPlayer.UUID] || 0;
    // Clicking the same arrow again clears the vote; otherwise set it.
    const nextValue = prev === delta ? 0 : delta;
    const nextVotes = { ...prevVotes };
    if (nextValue === 0) delete nextVotes[currentPlayer.UUID];
    else nextVotes[currentPlayer.UUID] = nextValue;

    await databaseConnection.add(STORES.journalComment, { ...comment, votes: nextVotes });
    loadComments();
    refreshApp();
  };

  return (
    <div className="detail-overlay">
      <div className="blanker" onClick={close} />
      <div className="detail-card journal-detail-card">
        <div className="detail-header">
          <div className="journal-detail-title-wrap">
            <div className="detail-eyebrow">JOURNAL ENTRY</div>
            {editing ? (
              <input
                className="journal-edit-title"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Entry title"
              />
            ) : (
              <h2 className="detail-title">{entry.title || 'Untitled entry'}</h2>
            )}
            <div className="journal-detail-date">
              {UTCStringToLocalDate(entry.createdAt)} · {UTCStringToLocalTime(entry.createdAt)}
              {entry.editedAt && (
                <span className="journal-edited-tag">
                  {' · '}edited {UTCStringToLocalDate(entry.editedAt)} {UTCStringToLocalTime(entry.editedAt)}
                </span>
              )}
            </div>
          </div>
          <div className="journal-detail-header-actions">
            {isOwner && !editing && (
              <button className="journal-header-btn" onClick={() => setEditing(true)}>EDIT</button>
            )}
            <button className="close-btn" onClick={close}>✕</button>
          </div>
        </div>

        <div className="detail-body journal-detail-body">

          {/* ── ENTRY CARD ───────────────────────────────── */}
          <section className="journal-card">
            {editing ? (
              <>
                <MarkdownEditor
                  value={draftBody}
                  onChange={setDraftBody}
                  placeholder="Write your entry... (**bold**, *italic*, # heading)"
                  className="journal-edit-body"
                />
                <div className="journal-edit-actions">
                  <button type="button" onClick={handleCancelEdit}>CANCEL</button>
                  <button type="button" className="primary" onClick={handleSaveEdit}>SAVE</button>
                </div>
              </>
            ) : (
              <div className="journal-entry-body">
                {entry.entry ? (
                  <MarkdownEditor
                    value={entry.entry}
                    readOnly
                    className="journal-entry-readonly"
                  />
                ) : (
                  <div className="journal-empty">No entry text.</div>
                )}
              </div>
            )}
          </section>

          {/* ── COMMENTS CARD ────────────────────────────── */}
          <section className="journal-card journal-comments-card">
            <div className="journal-card-header">
              <span className="detail-eyebrow">COMMENTS</span>
              <span className="journal-comments-count">{comments.length}</span>
            </div>

            <div className="journal-comments-body">
              {comments.length === 0 ? (
                <div className="journal-comments-empty">No comments yet. Be the first to respond.</div>
              ) : (
                <div className="journal-comments-list">
                  {comments.map((c) => (
                    <CommentRow
                      key={c.UUID}
                      comment={c}
                      author={authorsByUUID[c.authorUUID]}
                      isSelf={c.authorUUID === currentPlayer?.UUID}
                      voterUUID={currentPlayer?.UUID}
                      onDelete={handleDeleteComment}
                      onVote={handleVoteComment}
                      onOpenProfile={handleOpenProfile}
                    />
                  ))}
                </div>
              )}
            </div>

            {currentPlayer?.UUID && (
              <div className="journal-comment-compose">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder={isOwner ? 'Add a note to your entry...' : `Reply as ${currentPlayer.username}...`}
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }}
                />
                <button
                  type="button"
                  className="primary"
                  onClick={handleAddComment}
                  disabled={!newComment.trim()}
                >
                  POST
                </button>
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
});