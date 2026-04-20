import { useContext, useEffect, useState } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';
import MarkdownEditor from '../../components/MarkdownEditor/MarkdownEditor.jsx';
import './JournalPopup.css';

export default NiceModal.create(({ title }) => {
  const { databaseConnection, refreshApp } = useContext(AppContext);
  const modal = useModal();

  const [entryTitle, setEntryTitle] = useState(title || '');
  const [entryBody, setEntryBody]   = useState('');

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJournalSubmit = async (event) => {
    event.preventDefault();
    const parent = await databaseConnection.getCurrentPlayer();
    if (!parent?.UUID) return;

    await databaseConnection.add(STORES.journal, {
      title: entryTitle,
      entry: entryBody,
      createdAt: new Date().toISOString(),
      parent: parent.UUID,
      UUID: uuid(),
    });

    setEntryTitle('');
    setEntryBody('');
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
          <input
            type="text"
            value={entryTitle}
            onChange={(e) => setEntryTitle(e.target.value)}
            placeholder={title || 'Entry Title'}
          />
          <MarkdownEditor
            value={entryBody}
            onChange={setEntryBody}
            placeholder="Enter your log here... (**bold**, *italic*, # heading)"
            className="journal-entry-editor"
          />
          <button type="submit">Publish</button>
        </form>
      </div>
    </div>
  );
});
