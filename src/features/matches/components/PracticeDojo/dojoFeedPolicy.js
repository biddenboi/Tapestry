export function clampDojoFeedIndex(index, cardCount) {
  const count = Math.max(0, Math.floor(Number(cardCount) || 0));
  if (count === 0) return 0;
  const numericIndex = Math.floor(Number(index) || 0);
  return Math.max(0, Math.min(count - 1, numericIndex));
}

export function shouldRequestDojoRecommendation({
  cardCount = 0,
  sourceReady = false,
  requestInFlight = false,
  failed = false,
} = {}) {
  if (!sourceReady || requestInFlight || failed) return false;
  return Math.max(0, Math.floor(Number(cardCount) || 0)) === 0;
}

// Feed cards intentionally leave padding around the viewport, so one card is
// not exactly one clientHeight tall. Use the browser's real scroll geometry
// instead of deriving a theoretical maximum from card count.
export function maxDojoFeedScrollTop(scrollHeight, clientHeight) {
  const contentHeight = Math.max(0, Number(scrollHeight) || 0);
  const viewportHeight = Math.max(0, Number(clientHeight) || 0);
  return Math.max(0, contentHeight - viewportHeight);
}

export function clampDojoFeedScrollTop(scrollTop, scrollHeight, clientHeight) {
  const maximum = maxDojoFeedScrollTop(scrollHeight, clientHeight);
  return Math.max(0, Math.min(maximum, Number(scrollTop) || 0));
}

export function isAtDojoFeedEnd(scrollTop, scrollHeight, clientHeight, tolerance = 3) {
  const maximum = maxDojoFeedScrollTop(scrollHeight, clientHeight);
  const position = Math.max(0, Number(scrollTop) || 0);
  return position >= maximum - Math.max(0, Number(tolerance) || 0);
}

export function dojoFeedIndexFromScroll(scrollTop, scrollHeight, clientHeight, cardCount) {
  const count = Math.max(0, Math.floor(Number(cardCount) || 0));
  if (count <= 1) return 0;
  const maximum = maxDojoFeedScrollTop(scrollHeight, clientHeight);
  if (maximum <= 0) return 0;
  const position = clampDojoFeedScrollTop(scrollTop, scrollHeight, clientHeight);
  const progress = Math.max(0, Math.min(1, position / maximum));
  return clampDojoFeedIndex(Math.round(progress * (count - 1)), count);
}

export function createDojoVisibilityTracker({
  minimumVisibleRatio = 0.6,
  minimumVisibleMs = 500,
  now = () => Date.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (token) => clearTimeout(token),
  onPresented = () => {},
  onVisibilitySegment = () => {},
} = {}) {
  const entries = new Map();
  let disposed = false;

  const getEntry = (cardId) => {
    const key = String(cardId);
    if (!entries.has(key)) {
      entries.set(key, {
        cardId: key,
        visibleSince: null,
        accountedAt: null,
        ratio: 0,
        presented: false,
        resolved: false,
        timer: null,
        segmentSequence: 0,
        metadata: {},
      });
    }
    return entries.get(key);
  };

  const present = (entry, timestamp) => {
    if (entry.presented || entry.resolved || entry.visibleSince == null) return;
    entry.presented = true;
    entry.timer = null;
    entry.accountedAt = entry.visibleSince + Math.max(0, Number(minimumVisibleMs) || 0);
    onPresented({
      cardId: entry.cardId,
      occurredAtMs: timestamp,
      visibleMs: Math.max(0, Number(minimumVisibleMs) || 0),
      minimumVisibleRatio,
      metadata: entry.metadata,
    });
  };

  const flush = (entry, timestamp) => {
    if (entry.timer != null) clearTimer(entry.timer);
    entry.timer = null;
    if (entry.presented && entry.accountedAt != null) {
      const visibleMs = Math.max(0, timestamp - entry.accountedAt);
      if (visibleMs > 0) {
        entry.segmentSequence += 1;
        onVisibilitySegment({
          cardId: entry.cardId,
          segmentId: `${entry.cardId}:${entry.segmentSequence}`,
          visibleStartedAtMs: entry.accountedAt,
          occurredAtMs: timestamp,
          visibleMs,
          metadata: entry.metadata,
        });
      }
    }
    entry.visibleSince = null;
    entry.accountedAt = null;
    entry.ratio = 0;
  };

  return Object.freeze({
    observe(cardId, ratio, metadata = {}) {
      if (disposed || cardId == null) return;
      const entry = getEntry(cardId);
      if (entry.resolved) return;
      entry.metadata = metadata;
      const timestamp = now();
      const nextRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
      if (nextRatio >= minimumVisibleRatio) {
        entry.ratio = nextRatio;
        if (entry.visibleSince == null) {
          entry.visibleSince = timestamp;
          entry.accountedAt = timestamp;
          if (!entry.presented) {
            entry.timer = setTimer(() => {
              if (disposed || entry.resolved || entry.ratio < minimumVisibleRatio) return;
              present(entry, now());
            }, Math.max(0, Number(minimumVisibleMs) || 0));
          }
        } else if (!entry.presented
          && timestamp - entry.visibleSince >= minimumVisibleMs) {
          if (entry.timer != null) clearTimer(entry.timer);
          present(entry, timestamp);
        }
        return;
      }
      if (entry.visibleSince != null) flush(entry, timestamp);
    },
    resolve(cardId) {
      const entry = entries.get(String(cardId));
      if (!entry || entry.resolved) return;
      if (entry.visibleSince != null) flush(entry, now());
      entry.resolved = true;
    },
    discard(cardId) {
      const key = String(cardId);
      const entry = entries.get(key);
      if (!entry) return;
      if (entry.visibleSince != null) flush(entry, now());
      entries.delete(key);
    },
    snapshot(cardId) {
      const entry = entries.get(String(cardId));
      return entry ? Object.freeze({
        presented: entry.presented,
        resolved: entry.resolved,
        visible: entry.visibleSince != null,
        ratio: entry.ratio,
        segmentSequence: entry.segmentSequence,
      }) : null;
    },
    dispose() {
      if (disposed) return;
      for (const entry of entries.values()) {
        if (entry.visibleSince != null) flush(entry, now());
        else if (entry.timer != null) clearTimer(entry.timer);
      }
      entries.clear();
      disposed = true;
    },
  });
}
