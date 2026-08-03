import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import ReactMarkdown from 'react-markdown';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import ChronicleDraftService from '@data/persistence/services/ChronicleDraftService.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';
import { simpleMobileFeedback } from '@app/mobile/application/MobileFeedback.js';
import {
  buildMobileChronicleDraftRecord,
  findRestorableMobileChronicleDraft,
} from './MobileChronicleDraft.js';

export function MobileChronicleEntrySheet({ payload }) {
  const { closeSurface } = useMobileSurface();
  const { entry, author } = payload;
  return (
    <article className="mobile-sheet mobile-sheet--reader" role="dialog" aria-modal="true" aria-labelledby="mobile-chronicle-entry-title">
      <header><ProfileIdentity player={author} compact rank="compact" avatarSize={42} /><button type="button" onClick={() => closeSurface()}>Close</button></header>
      <div className="mobile-sheet-scroll">
        <span className="mobile-entry-visibility" aria-label={`Visibility: ${entry.visibility || 'private'}`}>{entry.visibility === 'global' ? '◎' : entry.visibility === 'fellows' ? '◉' : '●'} {entry.visibility || 'private'}</span>
        <h2 id="mobile-chronicle-entry-title">{entry.title || 'Chronicle entry'}</h2>
        <small>{new Date(entry.occurrenceAt || entry.publishedAt || entry.createdAt).toLocaleString()}</small>
        <div className="mobile-entry-markdown"><ReactMarkdown>{entry.entry || ''}</ReactMarkdown></div>
      </div>
    </article>
  );
}

export function MobileChronicleComposer({ payload }) {
  const { databaseConnection, currentPlayer, invalidateDomains } = useAppContext();
  const { closeSurface, presentFeedback, registerDismissGuard } = useMobileSurface();
  const drafts = useMemo(() => new ChronicleDraftService(databaseConnection), [databaseConnection]);
  const [draftId, setDraftId] = useState(() => uuid());
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState('fellows');
  const [saving, setSaving] = useState(false);
  const [restored, setRestored] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState('');
  const editedRef = useRef(false);
  const persistenceEnabledRef = useRef(true);
  const latestRef = useRef({
    draftId,
    playerUUID: currentPlayer?.UUID || null,
    title,
    body,
    visibility,
  });

  const updateLatest = useCallback((field, value) => {
    editedRef.current = true;
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
  }, [currentPlayer?.UUID, drafts]);

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
    void persistDraft();
    return true;
  }), [persistDraft, registerDismissGuard]);

  const cancel = async () => {
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
      <header><button type="button" onClick={cancel}>Cancel</button><h2 id="mobile-chronicle-composer-title">New entry</h2><button type="submit" className="primary" disabled={saving || !body.trim()}>{saving ? 'Saving…' : 'Save'}</button></header>
      <div className="mobile-sheet-scroll">
        {restored && <div className="mobile-draft-restored" role="status">Local draft restored</div>}
        <label className="mobile-field"><span>Title (optional)</span><input value={title} onChange={(event) => updateLatest('title', event.target.value)} maxLength={240} /></label>
        <label className="mobile-field mobile-field--hero"><span>Entry</span><textarea value={body} onChange={(event) => updateLatest('body', event.target.value)} autoFocus data-autofocus="true" rows={12} placeholder="Start writing…" /></label>
        <label className="mobile-visibility-row"><span>Visibility</span><select value={visibility} onChange={(event) => updateLatest('visibility', event.target.value)}><option value="private">Private</option><option value="fellows">Fellows</option><option value="global">Global</option></select></label>
        <small className="mobile-draft-status">Drafts save locally while you write.</small>
        {error && <div className="mobile-sheet-error" role="alert">{error}</div>}
      </div>
      <footer><button type="submit" className="primary" disabled={saving || !body.trim()}>{saving ? 'Saving…' : 'Save entry'}</button></footer>
    </form>
  );
}
