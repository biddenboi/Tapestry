export const MATCH_RATING_MODE = Object.freeze({
  rated: 'rated',
  unrated: 'unrated',
});

export function isRatedMatch(match) {
  if (match?.ratingMode === MATCH_RATING_MODE.unrated) return false;
  return match?.rulesetId === 'pair_match_v1'
    || match?.rulesSnapshot?.rulesetId === 'pair_match_v1'
    || match?.ratingMode === MATCH_RATING_MODE.rated
    || (
      match?.status === 'complete'
      && match?.ratingMode == null
      && (
        Number(match?.result?.playerEloChangesVersion || 0) > 0
        || Object.keys(match?.result?.playerEloChanges || {}).length > 0
        || (
          match?.result?.eloChange != null
          && Number.isFinite(Number(match.result.eloChange))
        )
      )
    );
}

export function matchRatingMode(match, fallback = MATCH_RATING_MODE.unrated) {
  if (match?.ratingMode === MATCH_RATING_MODE.rated) return MATCH_RATING_MODE.rated;
  if (match?.ratingMode === MATCH_RATING_MODE.unrated) return MATCH_RATING_MODE.unrated;
  if (isRatedMatch(match)) return MATCH_RATING_MODE.rated;
  return fallback;
}

export default isRatedMatch;
