import { useContext, useEffect } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';
import './JournalPopup.css';

export default NiceModal.create(({ title }) => {
  const { databaseConnection, refreshApp } = useContext(AppContext);
  const modal = useModal();

  const close = () => {
    modal.hide();
    modal.remove();
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') close();
    };
    const handleForceClose = () => close();
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('force-close-journal', handleForceClose);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('force-close-journal', handleForceClose);
    };
  }, []);

  const handleJournalSubmit = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const parent = await databaseConnection.getCurrentPlayer();

    await databaseConnection.add(STORES.journal, {
      title: formData.get('entry-title'),
      entry: formData.get('entry-text'),
      createdAt: new Date().toISOString(),
      parent: parent.UUID,
      UUID: uuid(),
    });

    event.currentTarget.reset();
    refreshApp();
    close();
  };

  if (!modal.visible) return null;

  return (
    <div className="journal-popup" title="Entry Popup">
      <div className="blanker" onClick={close} />
      <div className="content">
        <p>Entry</p>
        <form onSubmit={handleJournalSubmit}>
          <input type="text" name="entry-title" defaultValue={title || ''} placeholder={title || 'Entry Title'} />
          <textarea name="entry-text" placeholder="Enter your log here..." />
          <button type="submit">Publish</button>
        </form>
      </div>
    </div>
  );
});
