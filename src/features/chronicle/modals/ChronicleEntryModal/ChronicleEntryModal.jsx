import { useCallback, useEffect, useMemo, useState } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { STORES } from '@domain/constants.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import MarkdownEditor from '@shared/markdown-editor/MarkdownEditor.jsx';
import PostImageGallery from '@shared/post-images/PostImageGallery.jsx';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import ModalFrame from '@shared/ui/ModalFrame.jsx';
import ChronicleRepository from '@data/persistence/repositories/ChronicleRepository.js';
import ChronicleSocialRepository from '@data/persistence/repositories/ChronicleSocialRepository.js';
import ChronicleCollaborationService from '@data/persistence/services/ChronicleCollaborationService.js';
import { canEditEntry } from '@domain/chronicle/ChronicleAccessPolicy.js';
import ReactionBar from '@features/chronicle/components/ReactionBar/ReactionBar.jsx';
import ContextDrawer from '@features/chronicle/components/ContextDrawer/ContextDrawer.jsx';
import EssayReaderPage from '@features/chronicle/pages/EssayReaderPage/EssayReaderPage.jsx';
import ChronicleComposerModal from '@features/chronicle/modals/ChronicleComposerModal/ChronicleComposerModal.jsx';
import EntryAccessBadge from '@features/chronicle/components/EntryAccessBadge/EntryAccessBadge.jsx';
import EntryRevisionHistory from '@features/chronicle/components/EntryRevisionHistory/EntryRevisionHistory.jsx';
import {
  ACHIEVEMENT_EVENT_TYPE,
  createAchievementEvent,
  queueAchievementEvent,
} from '@domain/achievements/AchievementProcessing.js';
import '@features/chronicle/Chronicle.css';

function responseDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

export default NiceModal.create(({ item, onUpdated, mobileRestricted = false } = {}) => {
  const {
    databaseConnection,
    currentPlayer,
    ensureDomainLoaded,
    invalidateDomains,
    notify,
    openPanel,
  } = useAppContext();
  const modal = useModal();
  const chronicle = useMemo(() => new ChronicleRepository(databaseConnection), [databaseConnection]);
  const social = useMemo(() => new ChronicleSocialRepository(databaseConnection), [databaseConnection]);
  const collaboration = useMemo(() => new ChronicleCollaborationService(databaseConnection), [databaseConnection]);
  const [entry, setEntry] = useState(item);
  const [responses, setResponses] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [authors, setAuthors] = useState({});
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = String(entry?.parent) === String(currentPlayer?.UUID);
  const editable = canEditEntry(entry?.access || entry, { actorUUID: currentPlayer?.UUID });

  const load = useCallback(async () => {
    if (!entry?.UUID) return;
    await ensureDomainLoaded?.('feed');
    const viewerIGT = getCurrentIGT(currentPlayer);
    const [rows, reactionRows, players] = await Promise.all([
      databaseConnection.getCommentsForJournalThroughIGT(entry.UUID, viewerIGT),
      social.reactionsFor(entry.UUID),
      databaseConnection.getPlayersAtIGT(viewerIGT),
    ]);
    setResponses(rows);
    setReactions(reactionRows);
    setAuthors(Object.fromEntries(players.map((player) => [player.UUID, player])));
  }, [currentPlayer, databaseConnection, ensureDomainLoaded, entry?.UUID, social]);

  useEffect(() => { load(); }, [load]);
  if (!modal.visible || !entry) return null;

  const close = () => {
    if (busy) return;
    modal.hide();
    modal.remove();
  };

  const react = async (type) => {
    if (!currentPlayer?.UUID || busy) return;
    setBusy(true);
    try {
      if (type) {
        await social.react({ journalUUID: entry.UUID, reactorUUID: currentPlayer.UUID, type });
      } else {
        await social.clearReaction(entry.UUID, currentPlayer.UUID);
      }
      await load();
      invalidateDomains(DOMAIN_INVALIDATION.chronicleReactionWrite);
    } finally {
      setBusy(false);
    }
  };

  const addResponse = async (event) => {
    event.preventDefault();
    const text = response.trim();
    if (!text || !currentPlayer?.UUID || busy) return;
    setBusy(true);
    try {
      const commentUUID = uuid();
      await databaseConnection.add(STORES.journalComment, {
        UUID: commentUUID,
        journalUUID: entry.UUID,
        authorUUID: currentPlayer.UUID,
        text,
        createdAt: new Date().toISOString(),
        inGameTimestamp: getCurrentIGT(currentPlayer),
      });
      if (String(entry.parent) !== String(currentPlayer.UUID)) {
        await queueAchievementEvent(databaseConnection, createAchievementEvent({
          type: ACHIEVEMENT_EVENT_TYPE.semanticResponse,
          parent: currentPlayer.UUID,
          sourceUUID: commentUUID,
          payload: {
            targetProfileId: entry.parent,
            targetJournalId: entry.UUID,
            semanticKind: 'chronicle-response',
            meaningful: text.split(/\s+/).filter(Boolean).length >= 4,
          },
        }));
      }
      setResponse('');
      await load();
      invalidateDomains(DOMAIN_INVALIDATION.chronicleResponseWrite);
    } finally {
      setBusy(false);
    }
  };

  const removeResponse = async (commentUUID) => {
    setBusy(true);
    try {
      await databaseConnection.remove(STORES.journalComment, commentUUID);
      await load();
      invalidateDomains(DOMAIN_INVALIDATION.chronicleResponseWrite);
    } finally {
      setBusy(false);
    }
  };

  const suppressResurface = async () => {
    const metadata = await chronicle.setResurfacePolicy(entry.UUID, 'never');
    if (!metadata) return;
    const updated = { ...entry, ...metadata };
    setEntry(updated);
    onUpdated?.(updated);
    invalidateDomains(DOMAIN_INVALIDATION.chronicleWrite);
    notify?.({ title: 'Resurfacing turned off', message: 'This entry remains in your Chronicle.', kind: 'success' });
  };

  const editEntry = () => {
    close();
    NiceModal.show(ChronicleComposerModal, { entry, onCreated: onUpdated, mobileRestricted });
  };

  const addAddendum = () => {
    close();
    NiceModal.show(ChronicleComposerModal, {
      initialKind: 'entry',
      addendumTo: entry.UUID,
      onCreated: onUpdated,
    });
  };

  const archiveEntry = async () => {
    const { metadata } = await collaboration.archive({
      entryUUID: entry.UUID,
      actorUUID: currentPlayer.UUID,
      clientOperationId: `entry-archive:${entry.UUID}:${uuid()}`,
    });
    onUpdated?.({ ...entry, ...metadata });
    invalidateDomains(DOMAIN_INVALIDATION.chronicleWrite);
    notify?.({ title: 'Entry archived', message: 'It remains available in My Chronicle.', kind: 'success' });
    close();
  };

  if (entry.entryKind === 'essay') {
    return (
      <ModalFrame
        onClose={close}
        title={entry.title || 'Essay'}
        eyebrow="Chronicle"
        size="xl"
        accent="var(--color-feed)"
        className="chronicle-entry-modal chronicle-entry-modal--essay"
      >
        <EssayReaderPage entry={entry} owner={owner} onClose={close} />
        <EntryAccessBadge entry={entry} />
        {owner && !mobileRestricted && (
          <div className="chronicle-owner-actions">
            <button type="button" onClick={editEntry}>Edit essay</button>
            <button type="button" onClick={addAddendum}>Add addendum</button>
            <button type="button" onClick={archiveEntry}>Archive</button>
          </div>
        )}
        <EntryRevisionHistory entryUUID={entry.UUID} owner={owner && !mobileRestricted} onRestored={setEntry} />
        <section className="chronicle-social-section">
          <ReactionBar
            reactions={reactions}
            viewerUUID={currentPlayer?.UUID}
            enabled={entry.reactionsEnabled !== false}
            onReact={react}
          />
        </section>
      </ModalFrame>
    );
  }

  return (
    <ModalFrame
      onClose={close}
      title={entry.title || (entry.entryKind === 'moment' ? 'Moment' : 'Chronicle entry')}
      subtitle={new Date(entry.occurrenceAt || entry.createdAt).toLocaleString()}
      eyebrow={entry.entryKind || 'Entry'}
      size="xl"
      accent="var(--color-feed)"
      className="chronicle-entry-modal"
    >
      <article className="chronicle-entry-detail">
        <div className="chronicle-entry-detail__identity">
          <EntryAccessBadge entry={entry} />
          <span>Owned by {authors[entry.parent]?.username || entry.parent}</span>
          <span>Revision {entry.currentRevisionNumber || 1}</span>
        </div>
        <PostImageGallery images={entry.images || []} title={entry.title || 'Chronicle image'} variant="detail" />
        {entry.entry && <MarkdownEditor value={entry.entry} readOnly className="chronicle-reading-body" />}
        <ContextDrawer snapshot={entry.contextSnapshot} owner={owner} />
        {(owner || editable) && (!mobileRestricted || entry.entryKind === 'moment') && (
          <div className="chronicle-owner-actions">
            <button type="button" onClick={editEntry}>Edit</button>
            {!owner && <span>Content edits only; the owner keeps access and lifecycle control.</span>}
            {owner && !mobileRestricted && <button type="button" onClick={addAddendum}>Add addendum</button>}
            {owner && !mobileRestricted && (
              <button type="button" onClick={suppressResurface} disabled={entry.resurfacePolicy === 'never'}>
                {entry.resurfacePolicy === 'never' ? 'Resurfacing off' : 'Do not resurface'}
              </button>
            )}
            {owner && !mobileRestricted && <button type="button" onClick={archiveEntry}>Archive</button>}
          </div>
        )}
      </article>

      <EntryRevisionHistory entryUUID={entry.UUID} owner={owner && (!mobileRestricted || entry.entryKind === 'moment')} onRestored={setEntry} />

      <section className="chronicle-social-section">
        <ReactionBar
          reactions={reactions}
          viewerUUID={currentPlayer?.UUID}
          enabled={entry.reactionsEnabled !== false}
          onReact={react}
        />

        <div className="chronicle-responses">
          <header><h3>Responses</h3><span>{responses.length}</span></header>
          {responses.length === 0 && <p className="chronicle-quiet-copy">No responses yet.</p>}
          {responses.map((comment) => {
            const author = authors[comment.authorUUID];
            return (
              <article key={comment.UUID} className="chronicle-response">
                <button type="button" onClick={() => openPanel?.('profile', author?.UUID)} disabled={!author?.UUID}>
                  <ProfileIdentity identity={author} avatarOnly avatarSize={28} />
                </button>
                <div>
                  <header>
                    <strong>{author?.username || 'Unknown'}</strong>
                    <time>{responseDate(comment.createdAt)}</time>
                    {comment.authorUUID === currentPlayer?.UUID && (
                      <button type="button" onClick={() => removeResponse(comment.UUID)} aria-label="Delete response">×</button>
                    )}
                  </header>
                  <p>{comment.text}</p>
                </div>
              </article>
            );
          })}
          {entry.responsesEnabled !== false ? (
            <form onSubmit={addResponse}>
              <label htmlFor="chronicle-response-input">Leave a response</label>
              <textarea
                id="chronicle-response-input"
                value={response}
                onChange={(event) => setResponse(event.target.value)}
                placeholder="Respond to the writing…"
                rows={3}
              />
              <button type="submit" className="primary" disabled={!response.trim() || busy}>Respond</button>
            </form>
          ) : <p className="chronicle-quiet-copy">Responses are closed.</p>}
        </div>
      </section>
    </ModalFrame>
  );
});
