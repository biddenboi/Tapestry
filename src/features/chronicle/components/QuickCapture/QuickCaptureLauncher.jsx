import { useCallback, useEffect } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import ChronicleComposerModal from '@features/chronicle/modals/ChronicleComposerModal/ChronicleComposerModal.jsx';
import '@features/chronicle/Chronicle.css';

export default function QuickCaptureLauncher() {
  const { currentPlayer } = useAppContext();
  const open = useCallback((initialKind = 'moment') => {
    if (!currentPlayer?.UUID) return;
    NiceModal.show(ChronicleComposerModal, { initialKind, initialVisibility: 'private', quickCapture: true });
  }, [currentPlayer?.UUID]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        open('moment');
      }
    };
    const onRequest = (event) => open(event.detail?.initialKind || 'moment');
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('tapestry:quick-capture', onRequest);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('tapestry:quick-capture', onRequest);
    };
  }, [open]);

  return (
    <button
      type="button"
      className="hub-world-button hub-world-button--utility chronicle-quick-capture"
      onClick={() => open('moment')}
      disabled={!currentPlayer?.UUID}
      title="Quick Capture (Ctrl/Command + Shift + J)"
      aria-label="Quick capture"
      aria-keyshortcuts="Control+Shift+J Meta+Shift+J"
    >
      <span className="chronicle-quick-capture__icon" aria-hidden="true">✎</span>
    </button>
  );
}
