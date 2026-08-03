import useOverlayFocus from '@shared/ui/useOverlayFocus.js';
import '@shared/ui/UI.css';

export default function DrawerFrame({
  open = true,
  onClose,
  title,
  subtitle,
  eyebrow,
  footer,
  children,
  side = 'right',
  width,
  accent,
  className = '',
  modal = true,
  autoFocus = true,
}) {
  const frameRef = useOverlayFocus(open, onClose, true, autoFocus);
  if (!open) return null;

  return (
    <div className={`ui-drawer-shell ${modal ? '' : 'ui-drawer-shell--nonmodal'}`}>
      {modal && (
        <button type="button" className="ui-overlay__backdrop" onClick={onClose} aria-label="Close" tabIndex={-1} />
      )}
      <aside
        ref={frameRef}
        className={`ui-drawer ui-drawer--${side} ${className}`}
        style={{
          ...(width ? { '--drawer-width': width } : {}),
          ...(accent ? { '--drawer-accent': accent } : {}),
        }}
        role="dialog"
        aria-modal={modal ? 'true' : undefined}
        aria-label={title}
        tabIndex={-1}
      >
        <header className="ui-drawer__header">
          <div>
            {eyebrow && <span className="ui-drawer__eyebrow">{eyebrow}</span>}
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="ui-drawer__close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="ui-drawer__body">{children}</div>
        {footer && <footer className="ui-drawer__footer">{footer}</footer>}
      </aside>
    </div>
  );
}
