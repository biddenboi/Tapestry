import { buildMatchHighlights } from '@domain/matches/MatchHighlights.js';

self.onmessage = (event) => {
  const { id, type, payload } = event.data || {};
  try {
    if (type !== 'match-narration') throw new Error(`Unsupported worker job: ${type}`);
    const result = buildMatchHighlights(payload || {});
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
