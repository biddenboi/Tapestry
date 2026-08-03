import { useEffect } from 'react';

function applyVisualViewport(root, viewport, windowRef) {
  const height = Number(viewport?.height || windowRef?.innerHeight || 0);
  const offsetTop = Number(viewport?.offsetTop || 0);
  const layoutHeight = Number(windowRef?.innerHeight || height);
  const keyboardInset = Math.max(0, layoutHeight - height - offsetTop);
  root.style.setProperty('--visual-viewport-height', `${height}px`);
  root.style.setProperty('--visual-viewport-offset-top', `${offsetTop}px`);
  root.style.setProperty('--keyboard-inset', `${keyboardInset}px`);
  root.toggleAttribute('data-mobile-keyboard-open', keyboardInset > 80);
}

export function useVisualViewport() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const update = () => applyVisualViewport(root, viewport, window);
    update();
    viewport?.addEventListener?.('resize', update);
    viewport?.addEventListener?.('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener?.('resize', update);
      viewport?.removeEventListener?.('scroll', update);
      window.removeEventListener('resize', update);
      root.style.removeProperty('--visual-viewport-height');
      root.style.removeProperty('--visual-viewport-offset-top');
      root.style.removeProperty('--keyboard-inset');
      root.removeAttribute('data-mobile-keyboard-open');
    };
  }, []);
}

export default useVisualViewport;
