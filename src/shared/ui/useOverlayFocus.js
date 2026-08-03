import { useEffect, useRef } from 'react';

export default function useOverlayFocus(open, onClose, closeOnEscape = true, autoFocus = true, blockEscape = false) {
  const frameRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const frame = frameRef.current;
    if (autoFocus) {
      const explicitTarget = frame?.querySelector('[autofocus], [data-autofocus="true"]');
      const fallbackTarget = frame?.querySelector(
        'input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      (explicitTarget || fallbackTarget || frame)?.focus?.({ preventScroll: true });
    }

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (blockEscape) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        return;
      }
      if (closeOnEscape) onCloseRef.current?.();
    };
    document.addEventListener('keydown', handleKeyDown, { capture: blockEscape });

    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: blockEscape });
      if (autoFocus) previous?.focus?.();
    };
  }, [autoFocus, blockEscape, closeOnEscape, open]);

  return frameRef;
}
