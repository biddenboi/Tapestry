import { getPostTags, parseFeedSearch, postMatchesSearch } from '@domain/feed/PostTags.js';

function includes(value, needle) {
  return String(value || '').toLowerCase().includes(needle);
}

function exact(value, needle) {
  return String(value || '').trim().toLowerCase() === needle;
}

/**
 * Text-only relevance. This is called only for an active user search and does
 * not inspect votes, engagement, player state, behavior history, or randomness.
 */
export function scorePostTextRelevance(entry = {}, author = null, query = '') {
  const criteria = parseFeedSearch(query);
  if (!criteria.length) return 0;

  const title = String(entry.title || '').toLowerCase();
  const body = String(entry.entry || '').toLowerCase();
  const username = String(author?.username || '').toLowerCase();
  const tags = getPostTags(entry);

  return criteria.reduce((score, criterion) => {
    const term = criterion.value;
    if (criterion.type === 'tag') {
      return score + (tags.includes(term) ? 120 : 0);
    }

    let criterionScore = 0;
    if (exact(title, term)) criterionScore += 100;
    else if (title.startsWith(term)) criterionScore += 75;
    else if (includes(title, term)) criterionScore += 55;

    if (tags.includes(term)) criterionScore += 85;
    if (exact(username, term)) criterionScore += 70;
    else if (includes(username, term)) criterionScore += 45;
    if (includes(body, term)) criterionScore += criterion.type === 'literal' ? 35 : 25;

    return score + criterionScore;
  }, 0);
}

export function searchFeedEntries(entries = [], playersByUUID = {}, query = '') {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) return [];

  return (Array.isArray(entries) ? entries : [])
    .filter(Boolean)
    .filter((entry) => postMatchesSearch(entry, playersByUUID[entry.parent], normalizedQuery))
    .map((entry, inputIndex) => ({
      entry,
      inputIndex,
      relevance: scorePostTextRelevance(entry, playersByUUID[entry.parent], normalizedQuery),
    }))
    .sort((left, right) => right.relevance - left.relevance || left.inputIndex - right.inputIndex)
    .map(({ entry }) => entry);
}
