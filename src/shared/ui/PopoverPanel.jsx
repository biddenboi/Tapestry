import { useEffect } from 'react';
import '@shared/ui/UI.css';

export default function PopoverPanel({ open = true, onClose, children, className = '', ...props }) {
  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [onClose, open]);

  if (!open) return null;
  return <div className={`ui-popover ${className}`} role="menu" {...props}>{children}</div>;
}
