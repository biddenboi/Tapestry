import {
  useCallback,
  useLayoutEffect,
  useState,
} from 'react';
import {
  buildWorldRouteGeometry,
  parseRenderedCornerRadius,
  worldRouteGeometryChanged,
} from './worldRouteGeometry.js';

const COMPACT_ROUTE_QUERY = '(max-width: 760px)';

function compactRouteMatches() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(COMPACT_ROUTE_QUERY).matches;
}

export default function useWorldRouteGeometry({
  worldViewportRef,
  originElement,
  destinationElement,
  recommendationId,
  visible = true,
} = {}) {
  const [geometry, setGeometry] = useState(null);
  const [compact, setCompact] = useState(compactRouteMatches);

  const clearGeometry = useCallback(() => {
    setGeometry((current) => (current == null ? current : null));
  }, []);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia?.(COMPACT_ROUTE_QUERY);
    if (!media) return undefined;
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useLayoutEffect(() => {
    const viewport = worldViewportRef?.current;
    if (!visible || compact || !viewport || !originElement || !destinationElement) {
      clearGeometry();
      return undefined;
    }

    let frame = null;
    let active = true;
    const measure = () => {
      frame = null;
      if (!active || document.visibilityState === 'hidden') return;
      const viewportRect = viewport.getBoundingClientRect();
      const originRect = originElement.getBoundingClientRect();
      const destinationRect = destinationElement.getBoundingClientRect();
      const next = buildWorldRouteGeometry({
        viewportRect,
        originRect,
        destinationRect,
        originCornerRadius: parseRenderedCornerRadius(window.getComputedStyle(originElement)),
        destinationCornerRadius: parseRenderedCornerRadius(window.getComputedStyle(destinationElement)),
      });
      if (!next) {
        clearGeometry();
        return;
      }
      setGeometry((current) => (
        worldRouteGeometryChanged(current, next) ? next : current
      ));
    };
    const schedule = () => {
      if (!active || frame != null) return;
      frame = window.requestAnimationFrame(measure);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') clearGeometry();
      else schedule();
    };

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(schedule)
      : null;
    resizeObserver?.observe(viewport);
    resizeObserver?.observe(originElement);
    resizeObserver?.observe(destinationElement);

    const mutationObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(schedule)
      : null;
    mutationObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'data-theme',
        'data-theme-mode',
        'data-theme-preview',
        'data-app-scale',
      ],
    });

    window.addEventListener('resize', schedule);
    viewport.addEventListener('transitionend', schedule);
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.fonts?.addEventListener?.('loadingdone', schedule);
    document.fonts?.ready?.then(schedule).catch(() => {});
    schedule();

    return () => {
      active = false;
      if (frame != null) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener('resize', schedule);
      viewport.removeEventListener('transitionend', schedule);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.fonts?.removeEventListener?.('loadingdone', schedule);
    };
  }, [
    clearGeometry,
    compact,
    destinationElement,
    originElement,
    recommendationId,
    visible,
    worldViewportRef,
  ]);

  return { geometry, compact };
}
