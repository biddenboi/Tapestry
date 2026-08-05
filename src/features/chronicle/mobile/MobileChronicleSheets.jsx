import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import ReactMarkdown from 'react-markdown';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { STORES } from '@domain/constants.js';
import ChronicleDraftService from '@data/persistence/services/ChronicleDraftService.js';
import { ChronicleRevisionService } from '@data/persistence/services/ChronicleRevisionService.js';
import { canControlEntry, canEditEntry, normalizeChronicleAccess } from '@domain/chronicle/ChronicleAccessPolicy.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import PostImageGallery from '@shared/post-images/PostImageGallery.jsx';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';
import { simpleMobileFeedback } from '@app/mobile/application/MobileFeedback.js';
import {
  buildMobileChronicleDraftRecord,
  findRestorableMobileChronicleDraft,
} from './MobileChronicleDraft.js';

export function MobileChronicleEntrySheet({ payload }) {
  const { databaseConnection, currentPlayer, domainRevisions, invalidateDomains } = useAppContext();
  const { closeSurface, openSurface } = useMobileSurface();
  const { entry, author } = payload;
  const [responses, setResponses] = useState([]);
  const [authors, setAuthors] = useState(() => ({
    [String(author?.UUID || '')]: author,
  }));
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editable = canEditEntry(entry?.access || entry, { actorUUID: currentPlayer?.UUID });

  const loadResponses = useCallback(async () => {
    if (!entry?.UUID || !currentPlayer?.UUID) return;
    const viewerIGT = getCurrentIGT(currentPlayer);
    const [rows, players] = await Promise.all([
      databaseConnection.getCommentsForJournalThroughIGT(entry.UUID, viewerIGT),
      databaseConnection.getPlayersAtIGT(viewerIGT),
    ]);
    setResponses(rows);
    setAuthors(Object.fromEntries(players.map((player) => [String(player.UUID), player])));
  }, [currentPlayer, databaseConnection, entry?.UUID]);

  useEffect(() => { void loadResponses().catch(() => setResponses([])); }, [
    loadResponses,
    domainRevisions.chronicle,
    domainRevisions.journals,
  ]);

  const addResponse = async (event) => {
    event.preventDefault();
    const text = response.trim();
    if (!text || busy || !currentPlayer?.UUID) return;
    setBusy(true);
    setError('');
    try {
      const now = new Date().toISOString();
      await databaseConnection.add(STORES.journalComment, {
        UUID: uuid(),
        journalUUID: entry.UUID,
        authorUUID: currentPlayer.UUID,
        text,
        createdAt: now,
        updatedAt: now,
        inGameTimestamp: getCurrentIGT(currentPlayer),
      });
      setResponse('');
      invalidateDomains(DOMAIN_INVALIDATION.chronicleResponseWrite);
      await loadResponses();
    } catch (responseError) {
      setError(responseError?.message || 'The comment could not be posted.');
    } finally {
      setBusy(false);
    }
  };

  const removeResponse = async (comment) => {
    if (busy || String(comment.authorUUID) !== String(currentPlayer?.UUID)) return;
    setBusy(true);
    try {
      await databaseConnection.remove(STORES.journalComment, comment.UUID);
      invalidateDomains(DOMAIN_INVALIDATION.chronicleResponseWrite);
      await loadResponses();
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="mobile-sheet mobile-sheet--reader" role="dialog" aria-modal="true" aria-labelledby="mobile-chronicle-entry-title">
      <header><ProfileIdentity player={author} compact rank="compact" avatarSize={42} /><div className="mobile-entry-header-actions">{editable && <button type="button" onClick={() => openSurface('chronicle-composer', { editingEntry: entry, onCreated: payload.onChanged })}>Edit</button>}<button type="button" onClick={() => closeSurface()}>Close</button></div></header>
      <div className="mobile-sheet-scroll">
        <span className="mobile-entry-visibility" aria-label={`Visibility: ${entry.visibility || 'private'}`}>{entry.visibility === 'global' ? '◎' : entry.visibility === 'fellows' ? '◉' : '●'} {entry.visibility || 'private'}</span>
        <h2 id="mobile-chronicle-entry-title">{entry.title || 'Chronicle entry'}</h2>
        <small>{new Date(entry.occurrenceAt || entry.publishedAt || entry.createdAt).toLocaleString()}</small>
        <PostImageGallery images={entry.images || []} title={entry.title || 'Chronicle image'} variant="detail" />
        <div className="mobile-entry-markdown"><ReactMarkdown>{entry.entry || ''}</ReactMarkdown></div>
        <section className="mobile-entry-comments" aria-label="Comments">
          <header><h3>Comments</h3><span>{responses.length}</span></header>
          {!responses.length && <p>No comments yet.</p>}
          {responses.map((comment) => {
            const commentAuthor = authors[String(comment.authorUUID)] || null;
            return (
              <article key={comment.UUID}>
                <ProfileIdentity player={commentAuthor || { username: 'Unknown' }} compact avatarOnly avatarSize={32} />
                <div><header><strong>{commentAuthor?.username || 'Unknown'}</strong><time>{new Date(comment.createdAt).toLocaleString()}</time>{String(comment.authorUUID) === String(currentPlayer?.UUID) && <button type="button" aria-label="Delete comment" onClick={() => removeResponse(comment)}>×</button>}</header><p>{comment.text}</p></div>
              </article>
            );
          })}
          {entry.responsesEnabled !== false ? (
            <form onSubmit={addResponse}>
              <label htmlFor="mobile-comment-input">Add a comment</label>
              <textarea id="mobile-comment-input" value={response} onChange={(event) => setResponse(event.target.value)} rows={3} placeholder="Join the conversation…" />
              <button type="submit" className="primary" disabled={!response.trim() || busy}>{busy ? 'Posting…' : 'Post comment'}</button>
            </form>
          ) : <p>Comments are closed.</p>}
          {error && <div className="mobile-sheet-error" role="alert">{error}</div>}
        </section>
      </div>
    </article>
  );
}

export function MobileChronicleComposer({ payload }) {
  const { databaseConnection, currentPlayer, invalidateDomains } = useAppContext();
  const { closeSurface, presentFeedback, registerDismissGuard } = useMobileSurface();
  const drafts = useMemo(() => new ChronicleDraftService(databaseConnection), [databaseConnection]);
  const revisions = useMemo(() => new ChronicleRevisionService(databaseConnection), [databaseConnection]);
  const editingEntry = payload.editingEntry || null;
  const editing = Boolean(editingEntry?.UUID);
  const controlsEntry = editing && canControlEntry(editingEntry.access || editingEntry, currentPlayer?.UUID);
  const [draftId, setDraftId] = useState(() => uuid());
  const [title, setTitle] = useState(editingEntry?.title || '');
  const [body, setBody] = useState(editingEntry?.entry || '');
  const [visibility, setVisibility] = useState(editingEntry?.visibility || 'fellows');
  const [saving, setSaving] = useState(false);
  const [restored, setRestored] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const editedRef = useRef(false);
  const persistenceEnabledRef = useRef(!editing);
  const latestRef = useRef({
    draftId,
    playerUUID: currentPlayer?.UUID || null,
    title,
    body,
    visibility,
  });

  const updateLatest = useCallback((field, value) => {
    editedRef.current = true;
    setDirty(true);
    latestRef.current = { ...latestRef.current, [field]: value };
    if (field === 'title') setTitle(value);
    if (field === 'body') setBody(value);
    if (field === 'visibility') setVisibility(value);
  }, []);

  const persistDraft = useCallback(async () => {
    if (!persistenceEnabledRef.current || (!editedRef.current && !restored)) return null;
    const record = buildMobileChronicleDraftRecord(latestRef.current);
    if (!record) return null;
    return drafts.save(record);
  }, [drafts, restored]);

  useEffect(() => {
    if (!currentPlayer?.UUID) return;
    if (editing) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    latestRef.current = { ...latestRef.current, playerUUID: currentPlayer.UUID };
    drafts.list(currentPlayer.UUID).then((rows) => {
      if (cancelled) return;
      const saved = findRestorableMobileChronicleDraft(rows);
      if (saved) {
        setDraftId(saved.UUID);
        latestRef.current = { ...latestRef.current, draftId: saved.UUID };
        if (!editedRef.current) {
          const restoredValues = {
            title: saved.title || '',
            body: saved.body || '',
            visibility: saved.visibility || 'fellows',
          };
          latestRef.current = { ...latestRef.current, ...restoredValues };
          setTitle(restoredValues.title);
          setBody(restoredValues.body);
          setVisibility(restoredValues.visibility);
        }
        setRestored(Boolean(saved.body || saved.title));
      }
      setHydrated(true);
    }).catch((loadError) => {
      if (!cancelled) {
        setHydrated(true);
        setError(loadError?.message || 'The local draft could not be restored.');
      }
    });
    return () => { cancelled = true; };
  }, [currentPlayer?.UUID, drafts, editing]);

  useEffect(() => {
    latestRef.current = {
      ...latestRef.current,
      draftId,
      playerUUID: currentPlayer?.UUID || null,
      title,
      body,
      visibility,
    };
  }, [body, currentPlayer?.UUID, draftId, title, visibility]);

  useEffect(() => {
    if (!hydrated || !editedRef.current) return undefined;
    const timer = window.setTimeout(() => {
      persistDraft().catch((saveError) => setError(saveError?.message || 'The local draft could not be saved.'));
    }, 320);
    return () => window.clearTimeout(timer);
  }, [body, hydrated, persistDraft, title, visibility]);

  useEffect(() => {
    const flush = () => { void persistDraft(); };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [persistDraft]);

  useEffect(() => registerDismissGuard(() => {
    if (editing && dirty) {
      return window.confirm('Discard your unsaved Chronicle changes?');
    }
    void persistDraft();
    return true;
  }), [dirty, editing, persistDraft, registerDismissGuard]);

  const cancel = async () => {
    if (editing) {
      if (dirty && !window.confirm('Discard your unsaved Chronicle changes?')) return;
      closeSurface({ force: true });
      return;
    }
    try {
      await persistDraft();
      closeSurface({ force: true });
    } catch (saveError) {
      setError(saveError?.message || 'The local draft could not be saved.');
    }
  };

  const publish = async (event) => {
    event.preventDefault();
    if (!body.trim() || !draftId || saving) return;
    setSaving(true);
    setError('');
    try {
      if (editing) {
        const access = normalizeChronicleAccess(editingEntry.access || editingEntry, editingEntry);
        const expectedRevision = Number(editingEntry.currentRevisionNumber ?? editingEntry.revisionNumber);
        const result = await revisions.saveContent({
          actorUUID: currentPlayer.UUID,
          journal: {
            ...editingEntry,
            UUID: editingEntry.UUID,
            parent: editingEntry.parent,
            title: title.trim(),
            entry: body.trim(),
            visibility: controlsEntry ? visibility : access.visibility,
          },
          metadata: {
            ...editingEntry,
            UUID: editingEntry.UUID,
            journalUUID: editingEntry.UUID,
            parent: editingEntry.parent,
            playerUUID: editingEntry.parent,
            visibility: controlsEntry ? visibility : access.visibility,
            entryKind: editingEntry.entryKind || 'entry',
          },
          access: controlsEntry ? normalizeChronicleAccess({ ...access, visibility, editPolicy: visibility === 'global' ? 'any_profile' : 'owner' }, editingEntry) : access,
          expectedRevisionNumber: Number.isFinite(expectedRevision) ? expectedRevision : null,
          clientOperationId: uuid(),
          editSummary: 'Edited on mobile',
          commandOrigin: 'mobile',
        });
        invalidateDomains(DOMAIN_INVALIDATION.chronicleWrite || ['journals', 'chronicle']);
        presentFeedback(simpleMobileFeedback('chronicle-entry-edited', 'Chronicle revision saved', { significance: 'meaningful', sourceId: editingEntry.UUID }));
        await payload.onCreated?.(result);
        closeSurface({ force: true });
        return;
      }
      const result = await drafts.publish(buildMobileChronicleDraftRecord({
        draftId,
        playerUUID: currentPlayer.UUID,
        title,
        body,
        visibility,
      }), {
        journalUUID: uuid(),
        occurrenceAt: new Date().toISOString(),
        occurrenceIGT: getCurrentIGT(currentPlayer),
        visibility,
        commandOrigin: 'mobile',
      });
      invalidateDomains(DOMAIN_INVALIDATION.chronicleWrite || ['journals', 'chronicle']);
      presentFeedback(simpleMobileFeedback('chronicle-entry', 'Chronicle entry saved', {
        significance: 'meaningful',
        sourceId: result.journal?.UUID,
      }));
      persistenceEnabledRef.current = false;
      await payload.onCreated?.(result);
      closeSurface({ force: true });
    } catch (publishError) {
      setError(publishError?.message || 'The Chronicle entry could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="mobile-sheet mobile-sheet--editor mobile-chronicle-composer" role="dialog" aria-modal="true" aria-labelledby="mobile-chronicle-composer-title" onSubmit={publish}>
      <header><button type="button" onClick={cancel}>Cancel</button><h2 id="mobile-chronicle-composer-title">{editing ? 'Edit entry' : 'New entry'}</h2><button type="submit" className="primary" disabled={saving || !body.trim()}>{saving ? 'Saving…' : 'Save'}</button></header>
      <div className="mobile-sheet-scroll">
        {restored && <div className="mobile-draft-restored" role="status">Local draft restored</div>}
        <label className="mobile-field"><span>Title (optional)</span><input value={title} onChange={(event) => updateLatest('title', event.target.value)} maxLength={240} /></label>
        <label className="mobile-field mobile-field--hero"><span>Entry</span><textarea value={body} onChange={(event) => updateLatest('body', event.target.value)} autoFocus data-autofocus="true" rows={12} placeholder="Start writing…" /></label>
        <label className="mobile-visibility-row"><span>Visibility</span><select value={visibility} disabled={editing && !controlsEntry} onChange={(event) => updateLatest('visibility', event.target.value)}><option value="private">Private</option><option value="fellows">Fellows</option><option value="global">Global</option></select></label>
        <small className="mobile-draft-status">{editing ? 'Saves an attributed, reversible revision.' : 'Drafts save locally while you write.'}</small>
        {error && <div className="mobile-sheet-error" role="alert">{error}</div>}
      </div>
    </form>
  );
}
