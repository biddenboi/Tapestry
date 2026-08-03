const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const MAX_BUNDLE_SIZE = 4;

function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function contextKey(item) {
  return item.primaryStoryId
    ? `story:${item.primaryStoryId}`
    : item.canonicalContextKey
      ? `context:${item.canonicalContextKey}`
      : 'unlinked';
}

function groupingKey(item) {
  return [
    item.parent || item.playerUUID,
    localDateKey(item.occurrenceAt),
    contextKey(item),
  ].join('|');
}

function bundleRecord(items) {
  if (items.length === 1) return items[0];
  return {
    type: 'moment-bundle',
    UUID: `bundle:${items.map((item) => item.UUID).join(':')}`,
    parent: items[0].parent,
    occurrenceDate: localDateKey(items[0].occurrenceAt),
    primaryStoryId: items[0].primaryStoryId || null,
    canonicalContextKey: items[0].canonicalContextKey || null,
    publishedAt: items[0].publishedAt,
    items,
    itemCount: items.length,
  };
}

export function bundleChronicleMoments(entries = []) {
  const output = [];
  let pending = [];
  const flush = () => {
    if (pending.length) output.push(bundleRecord(pending));
    pending = [];
  };
  for (const entry of entries) {
    const isMoment = entry.entryKind === 'moment' && !entry.standaloneInFeed;
    const previous = pending.at(-1);
    const gap = previous
      ? Math.abs(new Date(previous.publishedAt).getTime() - new Date(entry.publishedAt).getTime())
      : 0;
    const mayJoin = isMoment
      && pending.length < MAX_BUNDLE_SIZE
      && previous?.entryKind === 'moment'
      && groupingKey(previous) === groupingKey(entry)
      && Number.isFinite(gap)
      && gap <= SIX_HOURS_MS;
    if (!mayJoin) flush();
    if (isMoment) pending.push(entry);
    else output.push(entry);
  }
  flush();
  return output;
}
