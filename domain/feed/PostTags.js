const TAG_PATTERN = /(^|\s)#([a-z0-9][a-z0-9_-]*)/gi;

export function normalizePostTags(tags = []) {
  const values = Array.isArray(tags) ? tags : [];
  return [...new Set(values
    .map((tag) => String(tag || '').trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean))];
}

export function extractPostTags(...values) {
  const tags = [];
  for (const value of values) {
    const text = String(value || '');
    for (const match of text.matchAll(TAG_PATTERN)) tags.push(match[2]);
  }
  return normalizePostTags(tags);
}

export function getPostTags(entry = {}) {
  return normalizePostTags([
    ...(Array.isArray(entry.tags) ? entry.tags : []),
    ...extractPostTags(entry.title, entry.entry),
  ]);
}

export function parseFeedSearch(query = '') {
  return String(query || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith('#')) {
        return { type: 'tag', value: part.slice(1).trim().toLowerCase() };
      }
      if (part.length >= 2 && part.startsWith('"') && part.endsWith('"')) {
        return { type: 'literal', value: part.slice(1, -1).toLowerCase() };
      }
      return { type: 'contains', value: part.toLowerCase() };
    })
    .filter((criterion) => criterion.value);
}

export function postMatchesSearch(entry, author, query) {
  const criteria = parseFeedSearch(query);
  if (!criteria.length) return true;

  const tags = getPostTags(entry);
  const haystack = [
    entry.title,
    entry.entry,
    author?.username,
    ...tags.map((tag) => `#${tag}`),
  ].filter(Boolean).join(' ').toLowerCase();

  return criteria.every((criterion) => (
    criterion.type === 'tag'
      ? tags.includes(criterion.value)
      : haystack.includes(criterion.value)
  ));
}
