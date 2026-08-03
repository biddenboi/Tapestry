import { useEffect, useState, useRef, useCallback } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { v4 as uuid } from 'uuid';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { useStandalonePanelLifecycle } from '@app/panel-lifecycle/PanelLifecycleContext.jsx';
import MarkdownEditor from '@shared/markdown-editor/MarkdownEditor.jsx';
import ConfirmDialog from '@shared/ui/ConfirmDialog.jsx';
import {
  assertDurableWrite,
  isCurrentSaveCompletion,
} from '@features/quick-notes/modals/QuickNotes/quickNotesPersistence.js';
import { createQuickNotesController } from '@features/quick-notes/modals/QuickNotes/QuickNotesController.js';
import { createQuickNoteDraftStore } from '@features/quick-notes/modals/QuickNotes/quickNoteRecovery.js';
import '@features/quick-notes/modals/QuickNotes/QuickNotes.css';

function getPreview(content) {
  if (!content) return 'No additional text';
  const stripped = content.replace(/[#*`_~\[\]]/g, '').trim();
  const lines = stripped.split('\n').filter((l) => l.trim());
  const body = lines.slice(1).join(' ') || lines[0] || '';
  return body.slice(0, 80) || 'No additional text';
}

function getTitle(content) {
  if (!content) return 'New Note';
  const firstLine = content.split('\n').find((l) => l.trim()) || '';
  return firstLine.replace(/^#+\s*/, '').slice(0, 50) || 'New Note';
}

function getWordCount(content = '') {
  const plain = String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#>*_~[\]()`.!?,:;/\\-]/g, ' ');
  return (plain.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || []).length;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default NiceModal.create(() => {
  const {
    databaseConnection,
    currentPlayer,
    ensureDomainLoaded,
  } = useAppContext();
  const modal = useModal();
  const notesLifecycle = useStandalonePanelLifecycle('notes', modal.visible);
  const { canLoad, isActive } = notesLifecycle;
  const modalRef = useRef(modal);
  modalRef.current = modal;

  const [notes, setNotes]       = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [recoveryDrafts, setRecoveryDrafts] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [content, setContent]   = useState('');
  const [search, setSearch]     = useState('');
  const [saving, setSaving]     = useState(false);
  const [dirty, setDirty]       = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [saveError, setSaveError] = useState('');
  const notesControllerRef = useRef(null);
  if (!notesControllerRef.current) notesControllerRef.current = createQuickNotesController();
  const notesController = notesControllerRef.current;
  const recoveryStoreRef = useRef(null);
  if (!recoveryStoreRef.current) {
    recoveryStoreRef.current = createQuickNoteDraftStore({ scope: currentPlayer?.UUID || 'unscoped' });
  }
  const recoveryStore = recoveryStoreRef.current;
  const initializationPromiseRef = useRef(null);
  const pendingSaveCountRef = useRef(0);
  // Stable refs so effects don't need to re-run when these change
  const activeIdRef  = useRef(activeId);
  const contentRef   = useRef(content);
  const dirtyRef     = useRef(dirty);
  const deleteTargetRef = useRef(deleteTarget);
  const mountedRef = useRef(false);
  useEffect(() => { activeIdRef.current  = activeId;  }, [activeId]);
  useEffect(() => { contentRef.current   = content;   }, [content]);
  useEffect(() => { dirtyRef.current     = dirty;     }, [dirty]);
  useEffect(() => { deleteTargetRef.current = deleteTarget; }, [deleteTarget]);

  const flushCanonicalWrite = useCallback(async () => {
    return assertDurableWrite(await databaseConnection.flushWrites());
  }, [databaseConnection]);

  const runDurableMutation = useCallback(async (mutation) => {
    await ensureDomainLoaded('notes');
    const result = await mutation();
    await flushCanonicalWrite();
    return result;
  }, [ensureDomainLoaded, flushCanonicalWrite]);

  // ── Load only the Notes domain for ordinary panel reads ─────
  const readNotes = useCallback(async () => {
    await ensureDomainLoaded('notes');
    const all = await databaseConnection.getQuickNotes();
    return [...all].sort((a, b) =>
      (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
    );
  }, [databaseConnection, ensureDomainLoaded]);

  const rememberSavedNotes = useCallback((rows) => {
    notesController.remember(rows);
  }, [notesController]);

  const loadNotes = useCallback(async () => {
    try {
      const [sorted, noteConflicts] = await Promise.all([
        readNotes(),
        databaseConnection.getNoteConflicts(),
      ]);
      rememberSavedNotes(sorted);
      if (mountedRef.current) {
        setNotes(sorted);
        setConflicts(noteConflicts);
        setRecoveryDrafts(recoveryStore.list());
        setLoadError(null);
      }
      return sorted;
    } catch (err) {
      console.error('QuickNotes: failed to load notes store', err);
      if (mountedRef.current) {
        setLoadError(err?.message || 'Notes store unavailable — reload the app and try again.');
      }
      throw err;
    }
  }, [databaseConnection, readNotes, recoveryStore, rememberSavedNotes]);

  const activateNote = useCallback((note) => {
    const noteId = note?.UUID || null;
    const noteContent = note?.content || '';
    activeIdRef.current = noteId;
    contentRef.current = noteContent;
    dirtyRef.current = false;
    notesController.activate(note || noteId, noteContent);
    setActiveId(noteId);
    setContent(noteContent);
    setDirty(false);
    setSaveError('');
  }, [notesController]);

  // ── Durable, per-note serialized save helper ───────────
  const saveNoteContent = useCallback((noteId, val) => (
    notesController.run(noteId, async () => {
      const confirmOperation = async (operationId, fallback = null) => {
        const confirmed = await databaseConnection.getNoteOperationResult(operationId) || fallback;
        if (confirmed?.status === 'conflict') {
          const error = new Error('A newer note revision was kept. Your text is available under Recovery drafts.');
          error.name = 'NoteConflictError';
          error.conflict = confirmed.conflict;
          throw error;
        }
        if (!confirmed?.record) throw new Error('The note write could not be confirmed by operation ID.');
        return confirmed.record;
      };

      const pendingWrite = notesController.pendingWrite(noteId);
      if (pendingWrite) {
        await ensureDomainLoaded('notes');
        await flushCanonicalWrite();
        const confirmedRecord = await confirmOperation(pendingWrite.operationId, pendingWrite.result);
        notesController.markSaved(noteId, confirmedRecord);
        notesController.clearPendingWrite(noteId, pendingWrite.operationId);
        if (pendingWrite.content === val) return confirmedRecord;
      }
      if (val === notesController.lastSavedContent(noteId)) return null;
      const base = notesController.baseFor(noteId);
      const operationId = uuid();
      let updateResult = null;
      try {
        await runDurableMutation(async () => {
          updateResult = await databaseConnection.updateNoteIfCurrent(noteId, {
            content: val,
            expectedRevision: base.revision,
            expectedHash: base.hash,
            operationId,
          });
        });
      } catch (error) {
        if (updateResult?.record && updateResult.status === 'applied') {
          notesController.rememberPendingWrite(noteId, {
            operationId,
            content: val,
            result: updateResult,
          });
        }
        throw error;
      }
      const confirmedRecord = await confirmOperation(operationId, updateResult);
      notesController.clearPendingWrite(noteId, operationId);
      notesController.markSaved(noteId, confirmedRecord);
      return confirmedRecord;
    })
  ), [databaseConnection, ensureDomainLoaded, flushCanonicalWrite, notesController, runDurableMutation]);

  const persistNote = useCallback(async (noteId, val, revision) => {
    if (!noteId) return true;
    if (
      val === notesController.lastSavedContent(noteId)
      && !notesController.hasPendingOperation(noteId)
    ) {
      const current = isCurrentSaveCompletion({
        activeNoteId: activeIdRef.current,
        noteId,
        currentContent: contentRef.current,
        savedContent: val,
        currentRevision: notesController.currentRevision(noteId),
        savedRevision: revision,
      });
      if (current && mountedRef.current) {
        dirtyRef.current = false;
        setDirty(false);
      }
      return true;
    }

    pendingSaveCountRef.current += 1;
    if (mountedRef.current) {
      setSaving(true);
      setSaveError('');
    }
    try {
      await saveNoteContent(noteId, val);
      const current = isCurrentSaveCompletion({
        activeNoteId: activeIdRef.current,
        noteId,
        currentContent: contentRef.current,
        savedContent: val,
        currentRevision: notesController.currentRevision(noteId),
        savedRevision: revision,
      });
      if (current) {
        recoveryStore.remove(noteId, { throughEditRevision: revision });
        dirtyRef.current = false;
        if (mountedRef.current) {
          setDirty(false);
          setSaveError('');
          await loadNotes();
        }
      }
      return true;
    } catch (err) {
      console.error('QuickNotes: save failed', err);
      if (
        activeIdRef.current === noteId
        && notesController.currentRevision(noteId) === revision
      ) {
        dirtyRef.current = true;
        if (mountedRef.current) {
          setDirty(true);
          setSaveError(err?.message || 'Save failed. Your note is still open and unsaved.');
        }
      }
      if (mountedRef.current) await loadNotes().catch(() => undefined);
      return false;
    } finally {
      pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1);
      if (mountedRef.current) setSaving(pendingSaveCountRef.current > 0);
    }
  }, [loadNotes, notesController, recoveryStore, saveNoteContent]);

  const flushUnsaved = useCallback(() => {
    notesController.cancelAutosave();
    const noteId = activeIdRef.current;
    if (!dirtyRef.current || !noteId) return Promise.resolve(true);
    return persistNote(
      noteId,
      contentRef.current,
      notesController.currentRevision(noteId),
    );
  }, [notesController, persistNote]);

  const initializeNotes = useCallback(async () => {
    await ensureDomainLoaded('notes');
    const existing = await databaseConnection.getQuickNotes();
    return [...existing].sort((a, b) =>
      (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
    );
  }, [databaseConnection, ensureDomainLoaded]);

  // ── On mount: hydrate, then load ─────────
  useEffect(() => {
    if (!canLoad) return undefined;
    mountedRef.current = true;
    let cancelled = false;
    if (!initializationPromiseRef.current) {
      initializationPromiseRef.current = initializeNotes();
    }
    initializationPromiseRef.current
      .then((sorted) => {
        if (cancelled || !mountedRef.current) return;
        rememberSavedNotes(sorted);
        setNotes(sorted);
        setLoadError(null);
        const first = sorted[0] || null;
        activateNote(first);
        const recovered = first
          ? recoveryStore.list().find((draft) => draft.noteId === first.UUID && draft.content !== first.content)
          : null;
        if (recovered) {
          notesController.recordEdit(first.UUID, first.content || '', recovered.content);
          contentRef.current = recovered.content;
          dirtyRef.current = true;
          setContent(recovered.content);
          setDirty(true);
          setSaveError('Recovered an unsaved local draft. It will be compared with the current revision before saving.');
        }
      })
      .catch((err) => {
        console.error('QuickNotes: initialization failed', err);
        if (!cancelled && mountedRef.current) {
          setLoadError(err?.message || 'Notes could not be loaded safely.');
        }
      })
      .finally(() => {
        if (!cancelled && mountedRef.current) setInitializing(false);
      });

    const onKey = async (e) => {
      if (e.key !== 'Escape' || deleteTargetRef.current) return;
      if (!await flushUnsaved()) return;
      modalRef.current.hide();
      modalRef.current.remove();
    };
    const onVisibilityChange = () => {
      if (document.hidden) void flushUnsaved();
    };
    const onPageHide = () => { void flushUnsaved(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      cancelled = true;
      notesController.cancelAutosave();
      void flushUnsaved();
      mountedRef.current = false;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [activateNote, canLoad, flushUnsaved, initializeNotes, notesController, recoveryStore, rememberSavedNotes]);

  if (!modal.visible) return null;

  const activeNote = notes.find((n) => n.UUID === activeId) || null;
  const wordCount = getWordCount(content);

  // ── Handlers ──────────────────────────────────────────
  const scheduleAutosave = (noteId, val) => {
    if (!isActive) return;
    notesController.schedule(noteId, val, persistNote);
  };

  const setContentDirty = (val) => {
    const noteId = activeIdRef.current;
    if (!noteId) return;
    const editRevision = notesController.recordEdit(noteId, contentRef.current, val);
    const base = notesController.baseFor(noteId);
    recoveryStore.save({
      noteId,
      content: val,
      baseRevision: base.revision,
      baseHash: base.hash,
      editRevision,
    });
    contentRef.current = val;
    setContent(val);
    dirtyRef.current = true;
    setDirty(true);
    setSaveError('');
    scheduleAutosave(noteId, val);
  };

  const handleContentChange = (val) => {
    setContentDirty(val);
  };

  const restoreContent = (result) => {
    if (!result) return;
    const noteId = activeIdRef.current;
    const base = notesController.baseFor(noteId);
    recoveryStore.save({
      noteId,
      content: result.content,
      baseRevision: base.revision,
      baseHash: base.hash,
      editRevision: result.revision,
    });
    contentRef.current = result.content;
    setContent(result.content);
    dirtyRef.current = true;
    setDirty(true);
    setSaveError('');
    scheduleAutosave(activeIdRef.current, result.content);
  };

  const undoContent = () => {
    restoreContent(notesController.undo(activeIdRef.current, contentRef.current));
  };

  const redoContent = () => {
    restoreContent(notesController.redo(activeIdRef.current, contentRef.current));
  };

  const handleEditorKeyDown = (e) => {
    const key = String(e.key || '').toLowerCase();
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redoContent();
      else undoContent();
    } else if (key === 'y' && !e.shiftKey) {
      e.preventDefault();
      redoContent();
    }
  };

  const switchNote = async (note) => {
    notesController.cancelAutosave();
    if (dirtyRef.current && activeIdRef.current) {
      const saved = await flushUnsaved();
      if (!saved) return;
    }
    try {
      const refreshed = await loadNotes();
      const fresh = refreshed.find((n) => n.UUID === note.UUID);
      if (fresh) activateNote(fresh);
    } catch { /* loadNotes already exposes the error */ }
  };

  const handleNew = async () => {
    notesController.cancelAutosave();
    if (dirtyRef.current && !await flushUnsaved()) return;
    const now = new Date().toISOString();
    const newNote = { UUID: uuid(), content: '', createdAt: now, updatedAt: now };
    const operationId = uuid();
    setSaveError('');
    try {
      const created = await notesController.run(newNote.UUID, () => runDurableMutation(
        () => databaseConnection.createNote(newNote, { operationId }),
      ));
      const confirmed = await databaseConnection.getNoteOperationResult(operationId) || created;
      if (confirmed?.status === 'conflict') throw new Error('That note ID already exists; no content was replaced.');
      notesController.markSaved(newNote.UUID, confirmed.record);
      const refreshed = await loadNotes();
      setNotes(refreshed);
      activateNote(refreshed.find((note) => note.UUID === newNote.UUID) || newNote);
    } catch (err) {
      console.error('QuickNotes: create failed', err);
      setSaveError(err?.message || 'The new note could not be saved.');
    }
  };

  const handleDelete = async (noteId) => {
    notesController.cancelAutosave();
    setSaveError('');
    try {
      const base = notesController.baseFor(noteId);
      const operationId = uuid();
      const deleted = await notesController.run(noteId, () => runDurableMutation(
        () => databaseConnection.deleteNoteIfCurrent(noteId, {
          expectedRevision: base.revision,
          expectedHash: base.hash,
          operationId,
        }),
      ));
      const confirmed = await databaseConnection.getNoteOperationResult(operationId) || deleted;
      if (confirmed?.status === 'conflict') {
        throw new Error('This note changed elsewhere and was not deleted. Reload it before trying again.');
      }
      recoveryStore.remove(noteId);
      notesController.remove(noteId);
      const refreshed = await loadNotes();
      setNotes(refreshed);
      if (noteId === activeIdRef.current) activateNote(refreshed[0] || null);
      setDeleteTarget(null);
    } catch (err) {
      console.error('QuickNotes: delete failed', err);
      setSaveError(err?.message || 'The note could not be deleted from SQLite.');
    }
  };

  const recoverAsNewNote = async ({ content: recoveredContent, conflictUUID = null, draftNoteId = null }) => {
    if (dirtyRef.current && !await flushUnsaved()) return;
    const now = new Date().toISOString();
    const newNote = {
      UUID: uuid(),
      content: recoveredContent || '',
      createdAt: now,
      updatedAt: now,
    };
    const operationId = uuid();
    try {
      await notesController.run(newNote.UUID, () => runDurableMutation(() => (
        conflictUUID
          ? databaseConnection.recoverNoteConflict(conflictUUID, newNote, { operationId })
          : databaseConnection.createNote(newNote, { operationId })
      )));
      const confirmed = await databaseConnection.getNoteOperationResult(operationId);
      if (!confirmed?.record || confirmed.status === 'conflict') {
        throw new Error('The recovery copy could not be confirmed. The original draft was kept.');
      }
      if (draftNoteId) recoveryStore.remove(draftNoteId);
      const refreshed = await loadNotes();
      activateNote(refreshed.find((note) => note.UUID === newNote.UUID) || confirmed.record);
    } catch (error) {
      setSaveError(error?.message || 'The recovery draft could not be copied into a new note.');
    }
  };

  const handleClose = async () => {
    if (!await flushUnsaved()) return;
    modal.hide();
    modal.remove();
  };

  const filtered = search.trim()
    ? notes.filter((n) => {
        const q = search.toLowerCase();
        return (
          getTitle(n.content).toLowerCase().includes(q) ||
          (n.content || '').toLowerCase().includes(q)
        );
      })
    : notes;

  return (
    <>
    <div className={`qn-overlay ${expanded ? 'qn-overlay--expanded' : ''}`} onClick={handleClose}>
      <div className={`qn-shell ${expanded ? 'qn-shell--expanded' : ''}`} onClick={(e) => e.stopPropagation()}>

        {/* ── Sidebar ───────────────────────────────────── */}
        <div className="qn-sidebar">
          <div className="qn-sidebar-header">
            <span className="qn-sidebar-title">NOTES</span>
            <button className="qn-new-btn" onClick={handleNew} title="New note" disabled={initializing}>+</button>
          </div>

          <div className="qn-search-wrap">
            <svg className="qn-search-icon" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              className="qn-search"
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="qn-search-clear" onClick={() => setSearch('')} title="Clear search" aria-label="Clear search">✕</button>
            )}
          </div>

          <div className="qn-list">
            {initializing ? (
              <div className="qn-empty">Loading notes…</div>
            ) : loadError ? (
              <div className="qn-empty qn-error">{loadError}</div>
            ) : filtered.length === 0 ? (
              <div className="qn-empty">
                {search ? 'No notes match your search.' : 'No notes yet. Add one to start writing.'}
              </div>
            ) : (
              filtered.map((note) => {
                const isActive = note.UUID === activeId;
                const title    = getTitle(note.content);
                const preview  = getPreview(note.content);
                return (
                  <button
                    key={note.UUID}
                    className={`qn-row ${isActive ? 'qn-row--active' : ''}`}
                    onClick={() => switchNote(note)}
                  >
                    <div className="qn-row-top">
                      <span className="qn-row-title">{title}</span>
                      <span className="qn-row-date">{formatDate(note.updatedAt || note.createdAt)}</span>
                    </div>
                    <div className="qn-row-preview">{preview}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Editor pane ───────────────────────────────── */}
        <div className="qn-pane">
          <div className="qn-pane-header">
            <div className="qn-pane-meta">
              {activeNote ? (
                <>
                  <span className="qn-pane-date">
                    {formatDate(activeNote.updatedAt || activeNote.createdAt)}
                  </span>
                  {saving  && <span className="qn-save-status">saving…</span>}
                  {!saving && dirty && <span className="qn-save-status qn-unsaved">unsaved</span>}
                  {saveError && <span className="qn-save-status qn-save-error" title={saveError}>{saveError}</span>}
                  <span className="qn-word-count">
                    {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
                  </span>
                </>
              ) : (
                <span className={saveError ? 'qn-save-status qn-save-error' : 'qn-pane-date'}>
                  {saveError || (initializing ? 'Loading notes…' : 'Select or create a note')}
                </span>
              )}
            </div>
            <div className="qn-pane-actions">
              <button
                type="button"
                className="qn-expand-btn"
                onClick={() => setExpanded((value) => !value)}
                title={expanded ? 'Exit full note mode' : 'Full note mode'}
                aria-label={expanded ? 'Exit full note mode' : 'Full note mode'}
              >
                {expanded ? '↙' : '↗'}
              </button>
              {activeNote && (
                <button className="danger qn-delete-btn" onClick={() => setDeleteTarget(activeId)} title="Delete note">
                  Delete
                </button>
              )}
              <button className="qn-close" onClick={handleClose}>✕</button>
            </div>
          </div>

          {(conflicts.length > 0 || recoveryDrafts.length > 0) && (
            <div className="qn-recovery-bar" role="status">
              <span>
                {conflicts.length + recoveryDrafts.length} recovery {conflicts.length + recoveryDrafts.length === 1 ? 'draft' : 'drafts'} kept without replacing newer notes.
              </span>
              <div className="qn-recovery-actions">
                {conflicts.slice(0, 2).map((conflict) => (
                  <button
                    type="button"
                    key={conflict.UUID}
                    onClick={() => recoverAsNewNote({ content: conflict.content, conflictUUID: conflict.UUID })}
                  >
                    Recover conflict
                  </button>
                ))}
                {recoveryDrafts.slice(0, 2).map((draft) => (
                  <button
                    type="button"
                    key={`local-${draft.noteId}`}
                    onClick={() => recoverAsNewNote({ content: draft.content, draftNoteId: draft.noteId })}
                  >
                    Recover local draft
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="qn-editor-wrap">
            {activeNote ? (
              <MarkdownEditor
                key={activeId}
                value={content}
                onChange={handleContentChange}
                onKeyDown={handleEditorKeyDown}
                placeholder={'# Note title\n\nStart writing… (**bold**, *italic*, # heading, [link](url))'}
                className="qn-editor"
              />
            ) : (
              <div className="qn-no-note">
                <div className="qn-no-note-icon">✎</div>
                <div className="qn-no-note-msg">No note selected</div>
                <button className="primary qn-no-note-btn" onClick={handleNew} disabled={initializing}>Add note</button>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
    <ConfirmDialog
      open={Boolean(deleteTarget)}
      title="Delete this note?"
      message="This cannot be undone."
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeleteTarget(null)}
      onConfirm={() => handleDelete(deleteTarget)}
    />
    </>
  );
});
