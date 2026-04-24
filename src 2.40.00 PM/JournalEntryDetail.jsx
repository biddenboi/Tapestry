import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useContext, useEffect, useState } from 'react';
import { AppContext } from '../../App';
import { STORES } from '../../utils/Constants';
import { UTCStringToLocalDate, UTCStringToLocalTime } from '../../utils/Helpers/Time';
import './JournalEntryDetail.css';

export default NiceModal.create(({ entry }) => {
  const { databaseConnection: db, refresh } = useContext(AppContext);
  const modal = useModal();

  const [editing, setEditing] = useState(false);
  const [title,   setTitle]   = useState(entry.title || '');
  const [text,    setText]    = useState(entry.entry || '');
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    const k = e => { if (e.key === 'Escape') { modal.hide(); modal.remove(); } };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await db.add(STORES.journal, { ...entry, title, entry: text });
    setSaving(false);
    setEditing(false);
    refresh();
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this entry?')) return;
    await db.remove(STORES.journal, entry.UUID);
    refresh();
    modal.hide();
    modal.remove();
  };

  return modal.visible ? (
    <div className="modal-blanker">
      <div className="modal-card jed-card">

        <div className="jed-header">
          {editing
            ? <input className="jed-title-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Entry title" autoFocus/>
            : <span className="modal-title">{entry.title || 'Journal entry'}</span>
          }
          <div className="jed-header-actions">
            {!editing && <button className="btn-ghost" onClick={() => setEditing(true)}>Edit</button>}
            {!editing && <button className="btn-danger jed-delete-btn" onClick={handleDelete}>Delete</button>}
            <button className="btn-ghost" onClick={() => { modal.hide(); modal.remove(); }}>✕</button>
          </div>
        </div>

        <span className="label-sm jed-date">
          {UTCStringToLocalDate(entry.createdAt)} at {UTCStringToLocalTime(entry.createdAt)}
        </span>

        {editing ? (
          <>
            <textarea
              className="jed-textarea"
              value={text}
              onChange={e => setText(e.target.value)}
              rows={10}
            />
            <div className="jed-actions">
              <button className="btn-ghost" onClick={() => {
                setEditing(false);
                setTitle(entry.title || '');
                setText(entry.entry  || '');
              }}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        ) : (
          <div className="jed-body">
            {text || <span style={{ color: 'var(--text3)' }}>No content.</span>}
          </div>
        )}
      </div>
    </div>
  ) : null;
});
