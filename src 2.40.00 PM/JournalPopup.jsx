import { AppContext } from '../../App';
import { useContext, useEffect } from 'react';
import { v4 as uuid } from 'uuid';
import './JournalPopup.css';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { STORES } from '../../utils/Constants';

export default NiceModal.create(({ title }) => {
  const { databaseConnection: db, refresh } = useContext(AppContext);
  const modal = useModal();

  useEffect(() => {
    const k = e => {
      if (e.key === 'Escape') { modal.hide(); modal.remove(); }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const formData   = new FormData(e.currentTarget);
    const entryTitle = formData.get('entry-title');
    const entryText  = formData.get('entry-text');
    const player     = await db.getOrCreatePlayer();

    await db.add(STORES.journal, {
      UUID:      uuid(),
      title:     entryTitle,
      entry:     entryText,
      createdAt: new Date().toISOString(),
    });

    e.target.reset();
    refresh();
    modal.hide();
    modal.remove();
  };

  return modal.visible ? (
    <div className="modal-blanker jp-blanker">
      <div className="modal-card jp-card">
        <div className="jp-header">
          <span className="modal-title">New entry</span>
          <button className="btn-ghost" onClick={() => { modal.hide(); modal.remove(); }}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="jp-form">
          <input
            type="text"
            name="entry-title"
            defaultValue={title || ''}
            placeholder={title || 'Entry title'}
          />
          <textarea
            name="entry-text"
            placeholder="Write your entry here…"
            rows={6}
          />
          <button type="submit" className="btn-primary jp-submit">Publish</button>
        </form>
      </div>
    </div>
  ) : null;
});
