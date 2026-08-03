export function compareChronicleFeedItems(left, right) {
  const byTime = String(right?.publishedAt || '').localeCompare(String(left?.publishedAt || ''));
  if (byTime) return byTime;
  return String(right?.journalUUID || right?.UUID || '')
    .localeCompare(String(left?.journalUUID || left?.UUID || ''));
}

export function encodeChronicleFeedCursor(item) {
  if (!item?.publishedAt) return null;
  return encodeURIComponent(JSON.stringify({
    version: 1,
    publishedAt: item.publishedAt,
    journalUUID: item.journalUUID || item.UUID,
  }));
}

export function decodeChronicleFeedCursor(cursor) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(String(cursor)));
    if (parsed.version !== 1 || !parsed.publishedAt || !parsed.journalUUID) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isAfterChronicleCursor(item, cursor) {
  const decoded = typeof cursor === 'string' ? decodeChronicleFeedCursor(cursor) : cursor;
  if (!decoded) return true;
  const itemTime = String(item.publishedAt || '');
  const cursorTime = String(decoded.publishedAt || '');
  return itemTime < cursorTime
    || (itemTime === cursorTime
      && String(item.journalUUID || item.UUID || '') < String(decoded.journalUUID));
}
