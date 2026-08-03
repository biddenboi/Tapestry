import useOverlayFocus from '@shared/ui/useOverlayFocus.js';
import { resolveModalDismissalPolicy } from '@shared/ui/modalDismissalPolicy.js';
import '@shared/ui/UI.css';

export default function ModalFrame({
  open = true,
  onClose,
  title,
  subtitle,
  eyebrow,
  hero,
  footer,
  children,
  size = 'md',
  accent,
  className = '',
  closeLabel = 'Close',
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  protectedEditor = false,
  labelledBy,
}) {
  const dismissal = resolveModalDismissalPolicy({
    protectedEditor,
    closeOnBackdrop,
    closeOnEscape,
    showCloseButton,
  });
  const frameRef = useOverlayFocus(
    open,
    onClose,
    dismissal.closeOnEscape,
    true,
    dismissal.blockEscape,
  );
  if (!open) return null;
  const titleId = labelledBy || `modal-title-${String(title || 'dialog').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <div className="ui-overlay">
      <button
        type="button"
        className="ui-overlay__backdrop"
        onClick={dismissal.closeOnBackdrop ? onClose : undefined}
        aria-label={dismissal.closeOnBackdrop ? closeLabel : undefined}
        tabIndex={-1}
      />
      <section
        ref={frameRef}
        className={`ui-modal ui-modal--${size} ${className}`}
        style={accent ? { '--modal-accent': accent } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        {(title || subtitle || eyebrow || (onClose && dismissal.showCloseButton)) && (
          <header className="ui-modal__header">
            <div>
              {eyebrow && <span className="ui-modal__eyebrow">{eyebrow}</span>}
              {title && <h2 id={titleId}>{title}</h2>}
              {subtitle && <p>{subtitle}</p>}
            </div>
            {onClose && dismissal.showCloseButton && (
              <button type="button" className="ui-modal__close" onClick={onClose} aria-label={closeLabel}>
                ×
              </button>
            )}
          </header>
        )}
        {hero && <div className="ui-modal__hero">{hero}</div>}
        <div className="ui-modal__body">{children}</div>
        {footer && <footer className="ui-modal__footer">{footer}</footer>}
      </section>
    </div>
  );
}
