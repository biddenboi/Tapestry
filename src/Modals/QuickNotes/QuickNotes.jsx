import { useContext, useEffect, useState, useRef, useCallback } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { v4 as uuid } from 'uuid';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';
import MarkdownEditor from '../../components/MarkdownEditor/MarkdownEditor.jsx';
import './QuickNotes.css';

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
  const { databaseConnection, currentPlayer, notify } = useContext(AppContext);
  const modal = useModal();

  const [notes, setNotes]       = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [content, setContent]   = useState('');
  const [search, setSearch]     = useState('');
  const [saving, setSaving]     = useState(false);
  const [dirty, setDirty]       = useState(false);
  const [loadError, setLoadError] = useState(null);
  const saveTimer = useRef(null);
  const lastSaved = useRef('');
  // Stable refs so effects don't need to re-run when these change
  const activeIdRef  = useRef(activeId);
  const contentRef   = useRef(content);
  const dirtyRef     = useRef(dirty);
  useEffect(() => { activeIdRef.current  = activeId;  }, [activeId]);
  useEffect(() => { contentRef.current   = content;   }, [content]);
  useEffect(() => { dirtyRef.current     = dirty;     }, [dirty]);

  // ── Load all notes ────────────────────────────────────
  const loadNotes = useCallback(async () => {
    try {
      const all = await databaseConnection.getAll(STORES.notes);
      const sorted = [...all].sort((a, b) =>
        (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
      );
      setNotes(sorted);
      setLoadError(null);
      return sorted;
    } catch (err) {
      console.error('QuickNotes: failed to load notes store', err);
      setLoadError('Notes store unavailable — the app may need a full reload.');
      return [];
    }
  }, [databaseConnection]);

  // ── Save helper ───────────────────────────────────────
  const persistNote = useCallback(async (noteId, val, silent = false) => {
    if (!noteId || val === lastSaved.current) return;
    setSaving(true);
    try {
      // Re-fetch fresh copy from DB to avoid stale note object
      const all = await databaseConnection.getAll(STORES.notes);
      const existing = all.find((n) => n.UUID === noteId);
      if (!existing) return;
      const updated = { ...existing, content: val, updatedAt: new Date().toISOString() };
      await databaseConnection.add(STORES.notes, updated);
      lastSaved.current = val;
      setDirty(false);
      if (!silent) await loadNotes();
    } catch (err) {
      console.error('QuickNotes: save failed', err);
    } finally {
      setSaving(false);
    }
  }, [databaseConnection, loadNotes]);

  // ── On mount: migrate old notes + load ───────────────
  useEffect(() => {
    const init = async () => {
      // Migrate old single-note from player profile if it exists
      try {
        const existing = await databaseConnection.getAll(STORES.notes);
        if (existing.length === 0 && currentPlayer?.quickNotes?.trim()) {
          const now = new Date().toISOString();
          const migrated = {
            UUID: uuid(),
            content: currentPlayer.quickNotes,
            createdAt: now,
            updatedAt: now,
          };
          await databaseConnection.add(STORES.notes, migrated);
        }
      } catch (_) { /* migration is best-effort */ }

      const sorted = await loadNotes();
      if (sorted.length > 0) {
        setActiveId(sorted[0].UUID);
        setContent(sorted[0].content || '');
        lastSaved.current = sorted[0].content || '';
      }
    };
    init();

    // Escape key — uses refs so this closure never goes stale
    const onKey = async (e) => {
      if (e.key !== 'Escape') return;
      clearTimeout(saveTimer.current);
      if (dirtyRef.current && activeIdRef.current) {
        await persistNote(activeIdRef.current, contentRef.current, true);
      }
      modal.hide();
      modal.remove();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!modal.visible) return null;

  const activeNote = notes.find((n) => n.UUID === activeId) || null;

  // ── Handlers ──────────────────────────────────────────
  const handleContentChange = (val) => {
    setContent(val);
    setDirty(true);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      persistNote(activeId, val, true).then(() => loadNotes());
    }, 900);
  };

  const switchNote = async (note) => {
    clearTimeout(saveTimer.current);
    if (dirty && activeId && content !== lastSaved.current) {
      await persistNote(activeId, content, true);
    }
    const refreshed = await loadNotes();
    const fresh = refreshed.find((n) => n.UUID === note.UUID);
    setActiveId(note.UUID);
    setContent(fresh?.content || '');
    lastSaved.current = fresh?.content || '';
    setDirty(false);
  };

  const handleNew = async () => {
    clearTimeout(saveTimer.current);
    if (dirty && activeId) await persistNote(activeId, content, true);
    const now = new Date().toISOString();
    const newNote = { UUID: uuid(), content: '', createdAt: now, updatedAt: now };
    await databaseConnection.add(STORES.notes, newNote);
    const refreshed = await loadNotes();
    setNotes(refreshed);
    setActiveId(newNote.UUID);
    setContent('');
    lastSaved.current = '';
    setDirty(false);
  };

  const handleDelete = async (noteId) => {
    if (!window.confirm('Delete this note?')) return;
    clearTimeout(saveTimer.current);
    await databaseConnection.remove(STORES.notes, noteId);
    const refreshed = await loadNotes();
    setNotes(refreshed);
    if (noteId === activeId) {
      const next = refreshed[0] || null;
      setActiveId(next?.UUID || null);
      setContent(next?.content || '');
      lastSaved.current = next?.content || '';
      setDirty(false);
    }
    notify?.({ title: 'Note deleted', message: 'Note removed.', kind: 'success', persist: false });
  };

  const handleClose = async () => {
    clearTimeout(saveTimer.current);
    if (dirty && activeId) await persistNote(activeId, content, true);
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
    <div className="qn-overlay" onClick={handleClose}>
      <div className="qn-shell" onClick={(e) => e.stopPropagation()}>

        {/* ── Sidebar ───────────────────────────────────── */}
        <div className="qn-sidebar">
          <div className="qn-sidebar-header">
            <span className="qn-sidebar-title">NOTES</span>
            <button className="qn-new-btn" onClick={handleNew} title="New note">+</button>
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
            {loadError ? (
              <div className="qn-empty qn-error">{loadError}</div>
            ) : filtered.length === 0 ? (
              <div className="qn-empty">
                {search ? 'No notes match your search.' : 'No notes yet — hit + to start.'}
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
                </>
              ) : (
                <span className="qn-pane-date">Select or create a note</span>
              )}
            </div>
            <div className="qn-pane-actions">
              {activeNote && (
                <button className="danger qn-delete-btn" onClick={() => handleDelete(activeId)} title="Delete note">
                  DELETE
                </button>
              )}
              <button className="qn-close" onClick={handleClose}>✕</button>
            </div>
          </div>

          <div className="qn-editor-wrap">
            {activeNote ? (
              <MarkdownEditor
                key={activeId}
                value={content}
                onChange={handleContentChange}
                placeholder={'# Note title\n\nStart writing… (**bold**, *italic*, # heading, [link](url))'}
                className="qn-editor"
              />
            ) : (
              <div className="qn-no-note">
                <div className="qn-no-note-icon">✎</div>
                <div className="qn-no-note-msg">No note selected</div>
                <button className="primary qn-no-note-btn" onClick={handleNew}>+ NEW NOTE</button>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
});
