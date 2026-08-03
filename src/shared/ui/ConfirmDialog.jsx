import useOverlayFocus from '@shared/ui/useOverlayFocus.js';
import ActionRow from '@shared/ui/ActionRow.jsx';
import '@shared/ui/UI.css';

export default function ConfirmDialog({
  open = true,
  title,
  message,
  target,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}) {
  const frameRef = useOverlayFocus(open, onCancel, false);
  if (!open) return null;

  return (
    <div className="ui-overlay">
      <div className="ui-overlay__backdrop" />
      <section ref={frameRef} className="ui-confirm" role="alertdialog" aria-modal="true" tabIndex={-1}>
        <h2>{title}</h2>
        <p>{message}{target ? ` ${target}` : ''}</p>
        <ActionRow>
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </ActionRow>
      </section>
    </div>
  );
}
