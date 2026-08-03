import { startTransition, useEffect, useMemo, useRef, useState } from 'react';

export default function useProgressiveList(items = [], pageSize = 20) {
  const safePageSize = Math.max(1, Number(pageSize) || 20);
  const [visibleCount, setVisibleCount] = useState(safePageSize);
  const sentinelRef = useRef(null);
  const pendingLoadRef = useRef(false);
  const loadTimerRef = useRef(null);
  const frameRef = useRef(null);
  const lastLoadAtRef = useRef(0);
  const itemsLengthRef = useRef(items.length);

  const listKey = useMemo(() => {
    const first = items[0]?.UUID || items[0]?.id || '';
    const last = items.at(-1)?.UUID || items.at(-1)?.id || '';
    return `${items.length}:${first}:${last}`;
  }, [items]);

  useEffect(() => {
    setVisibleCount(safePageSize);
  }, [listKey, safePageSize]);

  useEffect(() => {
    itemsLengthRef.current = items.length;
  }, [items.length]);

  useEffect(() => () => {
    if (typeof window === 'undefined') return;
    if (loadTimerRef.current != null) window.clearTimeout(loadTimerRef.current);
    if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
  }, []);

  const hasMore = visibleCount < items.length;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return undefined;
    const requestMore = () => {
      if (pendingLoadRef.current) return;
      pendingLoadRef.current = true;
      const schedule = () => {
        const waitMs = Math.max(0, 140 - (Date.now() - lastLoadAtRef.current));
        loadTimerRef.current = window.setTimeout(() => {
          loadTimerRef.current = null;
          pendingLoadRef.current = false;
          lastLoadAtRef.current = Date.now();
          startTransition(() => {
            setVisibleCount((count) => Math.min(itemsLengthRef.current, count + safePageSize));
          });
        }, waitMs);
      };
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        schedule();
      });
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) requestMore();
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, safePageSize]);

  const visibleItems = useMemo(
    () => items.slice(0, visibleCount),
    [items, visibleCount],
  );

  return { visibleItems, sentinelRef, hasMore, visibleCount };
}
